package auth

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"
)

type OidcConfig struct {
	Issuer         string
	PublicOrigin   string
	InternalOrigin string
	ClientID       string
	ClientSecret   string
	RedirectURI    string
}

type Endpoints struct {
	Authorization string
	Token         string
	UserInfo      string
	EndSession    string
	JWKS          string
	Issuers       []string
}

type Identity struct {
	Sub   string
	Email string
	Name  string
}

// urlValida: http sólo si no mira al exterior, o si es loopback. Sin usuario,
// contraseña, query ni fragmento, y sin barras finales.
func urlValida(crudo string, publica bool) string {
	crudo = strings.TrimSpace(crudo)
	if crudo == "" {
		return ""
	}
	u, err := url.Parse(crudo)
	if err != nil || u.Host == "" {
		return ""
	}
	loopback := u.Hostname() == "localhost" || u.Hostname() == "127.0.0.1" || u.Hostname() == "::1"
	if u.Scheme != "https" && !(u.Scheme == "http" && (!publica || loopback)) {
		return ""
	}
	if u.User != nil || u.RawQuery != "" || u.Fragment != "" {
		return ""
	}
	return strings.TrimRight(u.String(), "/")
}

func origen(crudo string) string {
	u, err := url.Parse(crudo)
	if err != nil {
		return ""
	}
	return u.Scheme + "://" + u.Host
}

func OidcFromEnv() *OidcConfig {
	clientID := strings.TrimSpace(os.Getenv("SECRETDROP_OIDC_CLIENT_ID"))
	clientSecret := strings.TrimSpace(os.Getenv("SECRETDROP_OIDC_CLIENT_SECRET"))
	issuer := urlValida(os.Getenv("SECRETDROP_OIDC_ISSUER"), true)
	interno := os.Getenv("SECRETDROP_OIDC_INTERNAL_BASE")
	if strings.TrimSpace(interno) == "" && issuer != "" {
		interno = origen(issuer)
	}
	internoValido := urlValida(interno, false)
	redirect := urlValida(os.Getenv("SECRETDROP_OIDC_REDIRECT_URI"), true)
	if clientID == "" || clientSecret == "" || issuer == "" || internoValido == "" || redirect == "" {
		return nil
	}
	return &OidcConfig{Issuer: issuer, PublicOrigin: origen(issuer), InternalOrigin: internoValido,
		ClientID: clientID, ClientSecret: clientSecret, RedirectURI: redirect}
}

func timeoutOidc() time.Duration {
	crudo := os.Getenv("SECRETDROP_OIDC_TIMEOUT_MS")
	ms := 10_000
	// Una variable vacía cae al valor por omisión, no a cero.
	if n, err := strconv.Atoi(strings.TrimSpace(crudo)); err == nil && crudo != "" {
		ms = min(60_000, max(1_000, n))
	}
	return time.Duration(ms) * time.Millisecond
}

// en cambia el origen de una URL conservando su ruta: el camino lo elige el
// proveedor, la dirección la elegimos nosotros según quién va a llamar.
//
// Host y puerto POR SEPARADO: dejar el puerto interno colado en la URL a la que
// se manda el navegador pasó en producción.
func en(endpoint, destino string) string {
	u, err := url.Parse(endpoint)
	if err != nil {
		return endpoint
	}
	d, err := url.Parse(destino)
	if err != nil {
		return endpoint
	}
	u.Scheme = d.Scheme
	u.Host = d.Host
	return u.String()
}

type Discovery struct {
	cliente *http.Client
	mu      sync.Mutex
	clave   string
	valor   *Endpoints
	cuando  time.Time
	ttl     time.Duration
	now     func() time.Time
}

func NewDiscovery() *Discovery {
	return &Discovery{cliente: &http.Client{Timeout: timeoutOidc()}, ttl: 10 * time.Minute, now: time.Now}
}

// Discover pregunta al proveedor y guarda el resultado diez minutos. Si falla y
// hay algo guardado, se devuelve lo guardado aunque esté pasado: quedarse sin
// proveedor un momento no debe apagar el inicio de sesión.
func (d *Discovery) Discover(ctx context.Context, cfg *OidcConfig) (*Endpoints, error) {
	clave := cfg.Issuer + "|" + cfg.InternalOrigin
	d.mu.Lock()
	if d.valor != nil && d.clave == clave && d.now().Sub(d.cuando) < d.ttl {
		valor := d.valor
		d.mu.Unlock()
		return valor, nil
	}
	viejo := d.valor
	viejaClave := d.clave
	d.mu.Unlock()

	destino := strings.TrimRight(en(cfg.Issuer, cfg.InternalOrigin), "/") + "/.well-known/openid-configuration"
	doc, err := d.pedirDoc(ctx, destino)
	if err != nil {
		if viejo != nil && viejaClave == clave {
			return viejo, nil
		}
		return nil, err
	}

	necesario := func(nombre string) (string, error) {
		v, _ := doc[nombre].(string)
		if v == "" {
			return "", fmt.Errorf("discovery: sin %s", nombre)
		}
		return v, nil
	}
	quiza := func(nombre string) string { v, _ := doc[nombre].(string); return v }

	authorization, err := necesario("authorization_endpoint")
	if err != nil {
		return nil, err
	}
	token, err := necesario("token_endpoint")
	if err != nil {
		return nil, err
	}
	userinfo, err := necesario("userinfo_endpoint")
	if err != nil {
		return nil, err
	}
	anunciado, _ := doc["issuer"].(string)
	if anunciado == "" {
		anunciado = cfg.Issuer
	}
	e := &Endpoints{
		Authorization: en(authorization, cfg.PublicOrigin),
		Token:         en(token, cfg.InternalOrigin),
		UserInfo:      en(userinfo, cfg.InternalOrigin),
		Issuers:       unicos(anunciado, en(anunciado, cfg.PublicOrigin), en(anunciado, cfg.InternalOrigin)),
	}
	if v := quiza("end_session_endpoint"); v != "" {
		e.EndSession = en(v, cfg.PublicOrigin)
	}
	if v := quiza("jwks_uri"); v != "" {
		e.JWKS = en(v, cfg.InternalOrigin)
	}
	d.mu.Lock()
	d.clave, d.valor, d.cuando = clave, e, d.now()
	d.mu.Unlock()
	return e, nil
}

func (d *Discovery) pedirDoc(ctx context.Context, destino string) (map[string]any, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, destino, nil)
	if err != nil {
		return nil, err
	}
	res, err := d.cliente.Do(req)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("discovery: %d", res.StatusCode)
	}
	var doc map[string]any
	if err := json.NewDecoder(res.Body).Decode(&doc); err != nil {
		return nil, err
	}
	return doc, nil
}

// Olvidar obliga a volver a preguntar. Sólo para las pruebas.
func (d *Discovery) Olvidar() {
	d.mu.Lock()
	d.valor, d.clave = nil, ""
	d.mu.Unlock()
}

func unicos(valores ...string) []string {
	vistos := map[string]bool{}
	var salida []string
	for _, v := range valores {
		if v != "" && !vistos[v] {
			vistos[v] = true
			salida = append(salida, v)
		}
	}
	return salida
}

func NewVerifier43() (string, error) {
	crudo := make([]byte, 32)
	if _, err := rand.Read(crudo); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(crudo), nil
}

func ChallengeFor(verifier string) string {
	suma := sha256.Sum256([]byte(verifier))
	return base64.RawURLEncoding.EncodeToString(suma[:])
}

func (d *Discovery) AuthorizeURL(ctx context.Context, cfg *OidcConfig, state, challenge string) (string, error) {
	e, err := d.Discover(ctx, cfg)
	if err != nil {
		return "", err
	}
	u, err := url.Parse(e.Authorization)
	if err != nil {
		return "", err
	}
	q := u.Query()
	q.Set("client_id", cfg.ClientID)
	q.Set("redirect_uri", cfg.RedirectURI)
	q.Set("response_type", "code")
	q.Set("scope", "openid email profile")
	q.Set("state", state)
	q.Set("code_challenge", challenge)
	q.Set("code_challenge_method", "S256")
	u.RawQuery = q.Encode()
	return u.String(), nil
}

// ExchangeCode canjea el código y pregunta quién es por UserInfo. La identidad
// sale de ahí y no del id_token, igual que en Node.
func (d *Discovery) ExchangeCode(ctx context.Context, cfg *OidcConfig, code, verifier string) (*Identity, error) {
	e, err := d.Discover(ctx, cfg)
	if err != nil {
		return nil, err
	}
	form := url.Values{
		"grant_type": {"authorization_code"}, "code": {code},
		"redirect_uri": {cfg.RedirectURI}, "client_id": {cfg.ClientID},
		"client_secret": {cfg.ClientSecret}, "code_verifier": {verifier},
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, e.Token, strings.NewReader(form.Encode()))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	res, err := d.cliente.Do(req)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("token endpoint: %d", res.StatusCode)
	}
	var tokens struct {
		AccessToken string `json:"access_token"`
	}
	if err := json.NewDecoder(res.Body).Decode(&tokens); err != nil || tokens.AccessToken == "" {
		return nil, errors.New("token endpoint: sin access_token")
	}

	info, err := http.NewRequestWithContext(ctx, http.MethodGet, e.UserInfo, nil)
	if err != nil {
		return nil, err
	}
	info.Header.Set("Authorization", "Bearer "+tokens.AccessToken)
	resInfo, err := d.cliente.Do(info)
	if err != nil {
		return nil, err
	}
	defer resInfo.Body.Close()
	if resInfo.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("userinfo: %d", resInfo.StatusCode)
	}
	var claims struct {
		Sub   string `json:"sub"`
		Email string `json:"email"`
		Name  string `json:"name"`
	}
	if err := json.NewDecoder(resInfo.Body).Decode(&claims); err != nil {
		return nil, err
	}
	if claims.Sub == "" || claims.Email == "" {
		return nil, errors.New("userinfo: falta sub o email")
	}
	return &Identity{Sub: claims.Sub, Email: strings.ToLower(claims.Email), Name: claims.Name}, nil
}

// SafeNext: sólo rutas internas. Sin esto, un enlace con ?next=https://otro
// convertiría el inicio de sesión en un redirector a donde quisiera quien lo
// mandara.
func SafeNext(crudo string) string {
	if crudo == "" {
		return "/"
	}
	var limpio strings.Builder
	for _, r := range crudo {
		if r <= 0x1F || r == 0x7F {
			continue
		}
		limpio.WriteRune(r)
	}
	s := limpio.String()
	if !strings.HasPrefix(s, "/") || strings.HasPrefix(s, "//") || strings.HasPrefix(s, "/\\") {
		return "/"
	}
	return s
}

// Issue acuña la cookie de sesión. `iat` es lo que permite revocar sin guardar
// sesiones: la lista dice desde cuándo dejó de valer lo de alguien.
func (v *Verifier) Issue(id Identity) string {
	ahora := v.now().UnixMilli()
	carga, err := json.Marshal(map[string]any{
		"sub": id.Sub, "email": id.Email, "name": id.Name,
		"iat": ahora, "exp": ahora + v.ttl.Milliseconds(),
	})
	if err != nil {
		return ""
	}
	codificada := base64.RawURLEncoding.EncodeToString(carga)
	return codificada + "." + v.firmar(codificada)
}

func (v *Verifier) TTL() time.Duration { return v.ttl }
