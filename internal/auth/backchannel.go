package auth

import (
	"context"
	"crypto"
	"crypto/rsa"
	"crypto/sha256"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"errors"
	"math/big"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

const eventoCierre = "http://schemas.openid.net/event/backchannel-logout"

// margen: dos minutos de holgura de reloj entre el proveedor y nosotros.
const margen = 120 * time.Second

// replayTTL: cuánto se recuerda un aviso ya aplicado. La memoria se pierde al
// reiniciar; lo que acota de verdad la reutilización es el `exp` del aviso,
// que desde el 06-09 es obligatorio.
const replayTTL = 10 * time.Minute

type Cierre struct {
	Sub string
	SID string
	JTI string
}

var (
	ErrNoConfigurado = errors.New("not_configured")
	ErrAvisoInvalido = errors.New("invalid logout_token")
	// ErrProveedor es un fallo NUESTRO: no se ha podido hablar con el
	// proveedor para comprobar la firma. Merece que lo reintente.
	ErrProveedor = errors.New("verification unavailable")
)

type Backchannel struct {
	cfg       *OidcConfig
	discovery *Discovery
	verifier  *Verifier
	cliente   *http.Client
	mu        sync.Mutex
	claves    map[string]*rsa.PublicKey
	pedidas   time.Time
	jtis      map[string]time.Time
	now       func() time.Time
}

func NewBackchannel(cfg *OidcConfig, d *Discovery, v *Verifier) *Backchannel {
	return &Backchannel{cfg: cfg, discovery: d, verifier: v,
		cliente: &http.Client{Timeout: timeoutOidc()},
		claves:  map[string]*rsa.PublicKey{}, jtis: map[string]time.Time{}, now: time.Now}
}

type jwk struct {
	Kty string `json:"kty"`
	Kid string `json:"kid"`
	N   string `json:"n"`
	E   string `json:"e"`
	Use string `json:"use"`
	Alg string `json:"alg"`
}

func (b *Backchannel) clavesDe(ctx context.Context, forzar bool) (map[string]*rsa.PublicKey, error) {
	b.mu.Lock()
	if !forzar && len(b.claves) > 0 && b.now().Sub(b.pedidas) < 10*time.Minute {
		copia := b.claves
		b.mu.Unlock()
		return copia, nil
	}
	b.mu.Unlock()

	e, err := b.discovery.Discover(ctx, b.cfg)
	if err != nil || e.JWKS == "" {
		return nil, ErrProveedor
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, e.JWKS, nil)
	if err != nil {
		return nil, ErrProveedor
	}
	res, err := b.cliente.Do(req)
	if err != nil {
		return nil, ErrProveedor
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return nil, ErrProveedor
	}
	var doc struct {
		Keys []jwk `json:"keys"`
	}
	if err := json.NewDecoder(res.Body).Decode(&doc); err != nil {
		return nil, ErrProveedor
	}
	nuevas := map[string]*rsa.PublicKey{}
	for _, k := range doc.Keys {
		if k.Kty != "RSA" || (k.Use != "" && k.Use != "sig") {
			continue
		}
		pub, err := aRSA(k)
		if err != nil {
			continue
		}
		nuevas[k.Kid] = pub
	}
	if len(nuevas) == 0 {
		return nil, ErrProveedor
	}
	b.mu.Lock()
	b.claves, b.pedidas = nuevas, b.now()
	b.mu.Unlock()
	return nuevas, nil
}

func aRSA(k jwk) (*rsa.PublicKey, error) {
	n, err := base64.RawURLEncoding.DecodeString(k.N)
	if err != nil {
		return nil, err
	}
	e, err := base64.RawURLEncoding.DecodeString(k.E)
	if err != nil {
		return nil, err
	}
	if len(e) > 8 {
		return nil, errors.New("exponente demasiado grande")
	}
	relleno := make([]byte, 8)
	copy(relleno[8-len(e):], e)
	return &rsa.PublicKey{N: new(big.Int).SetBytes(n), E: int(binary.BigEndian.Uint64(relleno))}, nil
}

// Verificar devuelve a quién hay que echar, o un error. Nunca lanza por un
// token malo: quien llama responde 400. El error de proveedor sí es nuestro.
func (b *Backchannel) Verificar(ctx context.Context, jwt string) (*Cierre, error) {
	partes := strings.Split(jwt, ".")
	if len(partes) != 3 {
		return nil, ErrAvisoInvalido
	}
	var cabecera struct {
		Alg string `json:"alg"`
		Kid string `json:"kid"`
	}
	crudoCab, err := base64.RawURLEncoding.DecodeString(partes[0])
	if err != nil || json.Unmarshal(crudoCab, &cabecera) != nil {
		return nil, ErrAvisoInvalido
	}
	// Sólo RS256. `none` y `HS256` son los dos fallos clásicos: el primero no
	// firma nada y el segundo deja firmar con un secreto que el atacante ya
	// tiene si conoce la clave pública.
	if cabecera.Alg != "RS256" {
		return nil, ErrAvisoInvalido
	}
	firma, err := base64.RawURLEncoding.DecodeString(partes[2])
	if err != nil {
		return nil, ErrAvisoInvalido
	}
	firmado := partes[0] + "." + partes[1]
	suma := sha256.Sum256([]byte(firmado))

	claves, err := b.clavesDe(ctx, false)
	if err != nil {
		return nil, err
	}
	valida := b.comprobarFirma(claves, cabecera.Kid, suma[:], firma)
	if !valida {
		// Puede que el proveedor haya rotado: se vuelve a preguntar una vez.
		claves, err = b.clavesDe(ctx, true)
		if err != nil {
			return nil, err
		}
		valida = b.comprobarFirma(claves, cabecera.Kid, suma[:], firma)
	}
	if !valida {
		return nil, ErrAvisoInvalido
	}

	crudo, err := base64.RawURLEncoding.DecodeString(partes[1])
	if err != nil {
		return nil, ErrAvisoInvalido
	}
	var carga map[string]json.RawMessage
	if json.Unmarshal(crudo, &carga) != nil {
		return nil, ErrAvisoInvalido
	}
	e, err := b.discovery.Discover(ctx, b.cfg)
	if err != nil {
		return nil, ErrProveedor
	}
	return b.comprobarClaims(carga, e)
}

func (b *Backchannel) comprobarFirma(claves map[string]*rsa.PublicKey, kid string, resumen, firma []byte) bool {
	if kid != "" {
		if k, hay := claves[kid]; hay {
			return rsa.VerifyPKCS1v15(k, crypto.SHA256, resumen, firma) == nil
		}
		// Sin coincidencia de kid se prueban todas: un proveedor puede no
		// mandar kid, y rechazar por eso apagaría el cierre de sesión.
	}
	for _, k := range claves {
		if rsa.VerifyPKCS1v15(k, crypto.SHA256, resumen, firma) == nil {
			return true
		}
	}
	return false
}

func texto(carga map[string]json.RawMessage, nombre string) string {
	crudo, hay := carga[nombre]
	if !hay {
		return ""
	}
	var v string
	if json.Unmarshal(crudo, &v) != nil {
		return ""
	}
	return v
}

func numero(carga map[string]json.RawMessage, nombre string) (float64, bool) {
	crudo, hay := carga[nombre]
	if !hay {
		return 0, false
	}
	var v float64
	if json.Unmarshal(crudo, &v) != nil {
		return 0, false
	}
	return v, true
}

func (b *Backchannel) comprobarClaims(carga map[string]json.RawMessage, e *Endpoints) (*Cierre, error) {
	iss := strings.TrimRight(texto(carga, "iss"), "/")
	valido := false
	for _, candidato := range e.Issuers {
		if strings.TrimRight(candidato, "/") == iss {
			valido = true
			break
		}
	}
	if !valido {
		return nil, ErrAvisoInvalido
	}

	// `aud` puede ser texto o lista.
	destinatarios := []string{}
	if crudo, hay := carga["aud"]; hay {
		var uno string
		var varios []string
		if json.Unmarshal(crudo, &uno) == nil {
			destinatarios = []string{uno}
		} else if json.Unmarshal(crudo, &varios) == nil {
			destinatarios = varios
		}
	}
	paraNosotros := false
	for _, d := range destinatarios {
		if d == b.cfg.ClientID {
			paraNosotros = true
			break
		}
	}
	if !paraNosotros {
		return nil, ErrAvisoInvalido
	}

	ahora := b.now().Unix()
	// `exp` es REQUERIDO (§2.4 y errata 1). Antes se miraba sólo si venía y era
	// número, y un aviso sin caducidad no caduca nunca.
	exp, hayExp := numero(carga, "exp")
	if !hayExp || int64(exp)+int64(margen.Seconds()) < ahora {
		return nil, ErrAvisoInvalido
	}
	iat, hayIat := numero(carga, "iat")
	if !hayIat || int64(iat)-int64(margen.Seconds()) > ahora {
		return nil, ErrAvisoInvalido
	}
	jti := strings.TrimSpace(texto(carga, "jti"))
	if jti == "" {
		return nil, ErrAvisoInvalido
	}

	// Que sea de verdad un aviso de cierre y no otro token del mismo emisor.
	crudoEventos, hay := carga["events"]
	if !hay {
		return nil, ErrAvisoInvalido
	}
	var eventos map[string]json.RawMessage
	if json.Unmarshal(crudoEventos, &eventos) != nil || eventos == nil {
		return nil, ErrAvisoInvalido
	}
	if _, hay := eventos[eventoCierre]; !hay {
		return nil, ErrAvisoInvalido
	}
	// La especificación lo prohíbe: un `nonce` delata un id_token disfrazado.
	if _, hay := carga["nonce"]; hay {
		return nil, ErrAvisoInvalido
	}

	sub, sid := texto(carga, "sub"), texto(carga, "sid")
	if sub == "" && sid == "" {
		return nil, ErrAvisoInvalido
	}

	// El anti-replay va el ÚLTIMO: sólo se mira un `jti` que ya ha pasado todo
	// lo demás, para que nadie pueda envenenar la memoria con tokens inválidos.
	// Y aquí sólo se COMPRUEBA: apuntarlo es cosa de quien consiga escribir la
	// revocación, para que un fallo de disco no queme el aviso.
	if b.yaVisto(jti) {
		return nil, ErrAvisoInvalido
	}
	return &Cierre{Sub: sub, SID: sid, JTI: jti}, nil
}

func (b *Backchannel) yaVisto(jti string) bool {
	b.mu.Lock()
	defer b.mu.Unlock()
	ahora := b.now()
	for k, caduca := range b.jtis {
		if !caduca.After(ahora) {
			delete(b.jtis, k)
		}
	}
	_, hay := b.jtis[jti]
	return hay
}

// Aplicado apunta un aviso ya atendido. Lo llama quien ha dejado constancia de
// la revocación, no quien sólo ha verificado el token.
func (b *Backchannel) Aplicado(jti string) {
	b.mu.Lock()
	b.jtis[jti] = b.now().Add(replayTTL)
	b.mu.Unlock()
}

// Revocar marca que todo lo emitido para esa persona hasta ahora deja de valer.
// Devuelve error si no se puede escribir: perderla en silencio sería dejar
// dentro a quien se acaba de echar.
func (v *Verifier) Revocar(sub string) error {
	v.mu.Lock()
	defer v.mu.Unlock()
	mapa := map[string]int64{}
	if crudo, err := os.ReadFile(v.archivo()); err == nil {
		_ = json.Unmarshal(crudo, &mapa)
	}
	limite := v.now().Add(-RevocationTTL).UnixMilli()
	for k, cuando := range mapa {
		if cuando < limite {
			delete(mapa, k)
		}
	}
	mapa[sub] = v.now().UnixMilli()

	if err := os.MkdirAll(filepath.Dir(v.archivo()), 0o700); err != nil {
		return err
	}
	datos, err := json.Marshal(mapa)
	if err != nil {
		return err
	}
	// Atómica: un fichero a medias por un corte dejaría la lista ilegible.
	tmp, err := os.CreateTemp(filepath.Dir(v.archivo()), ".revocaciones-*.json")
	if err != nil {
		return err
	}
	nombre := tmp.Name()
	defer os.Remove(nombre)
	if err := tmp.Chmod(0o600); err != nil {
		tmp.Close()
		return err
	}
	if _, err := tmp.Write(datos); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Sync(); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	if err := os.Rename(nombre, v.archivo()); err != nil {
		return err
	}
	v.cargadas = false // que la próxima lectura vea lo recién escrito
	return nil
}
