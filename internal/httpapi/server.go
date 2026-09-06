// Package httpapi sirve la API de secretos con la biblioteca estándar. Los
// cuerpos de error y los códigos son los mismos que en Node porque las suites
// los comprueban uno a uno: cambiar un texto aquí es cambiar el contrato.
package httpapi

import (
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"html/template"
	"io"
	"math"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/Ulzuhan/secretdrop/internal/auth"
	"github.com/Ulzuhan/secretdrop/internal/store"
	"github.com/Ulzuhan/secretdrop/internal/web"
)

const (
	maxCiphertext = 256 * 1024
	maxIV         = 256
	// El cuerpo se lee acotado: esta ruta acepta hasta 256 KiB de criptograma,
	// y por encima de eso no hay nada legítimo que leer.
	maxCuerpo = maxCiphertext + 8*1024
)

type Server struct {
	store       *store.Store
	verifier    *auth.Verifier
	discovery   *auth.Discovery
	oidc        *auth.OidcConfig
	backchannel *auth.Backchannel
	limiter     *limiter
	recursos    web.Recursos
	publicHost  string
	now         func() time.Time
}

func New(s *store.Store, v *auth.Verifier, oidc *auth.OidcConfig, d *auth.Discovery, publicHost string) *Server {
	recursos, err := web.Cargar()
	if err != nil {
		// Un manifiesto ilegible no puede pasar por «no hay interfaz»: eso
		// serviría un documento sin script y sin decir por qué.
		panic("no se pudo leer el manifiesto de la interfaz: " + err.Error())
	}
	srv := &Server{store: s, verifier: v, oidc: oidc, discovery: d,
		limiter: newLimiter(), recursos: recursos, publicHost: publicHost, now: time.Now}
	// Sin configuración de identidad no hay forma de entrar, y tampoco aviso de
	// cierre que atender: la ruta responde 404 en vez de fingir que existe.
	if oidc != nil {
		srv.backchannel = auth.NewBackchannel(oidc, d, v)
	}
	return srv
}

func escribirJSON(w http.ResponseWriter, estado int, cuerpo any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(estado)
	_ = json.NewEncoder(w).Encode(cuerpo)
}

func (s *Server) cuenta(r *http.Request) *auth.Account {
	c, err := r.Cookie(auth.CookieName)
	if err != nil {
		return nil
	}
	return s.verifier.Account(c.Value)
}

// exigirCuenta devuelve nil y responde 401 si no hay sesión.
func (s *Server) exigirCuenta(w http.ResponseWriter, r *http.Request) *auth.Account {
	cuenta := s.cuenta(r)
	if cuenta == nil {
		escribirJSON(w, http.StatusUnauthorized, map[string]any{"error": "Sign in to use this"})
		return nil
	}
	return cuenta
}

func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/secrets", s.listar)
	mux.HandleFunc("POST /api/secrets", s.crear)
	mux.HandleFunc("GET /api/secrets/{id}", s.consumir)
	mux.HandleFunc("POST /api/cleanup", s.limpiar)
	mux.HandleFunc("GET /api/auth/login", s.login)
	mux.HandleFunc("GET /api/auth/callback", s.callback)
	mux.HandleFunc("POST /api/auth/logout", s.logout)
	mux.HandleFunc("POST /api/auth/backchannel-logout", s.backchannelLogout)
	mux.HandleFunc("GET /api/health", s.salud)
	mux.HandleFunc("GET /v/{id}", s.visor)
	mux.HandleFunc("GET /robots.txt", s.robots)
	if recursos, err := web.Handler(); err == nil {
		mux.Handle("GET /assets/", recursos)
	}
	mux.HandleFunc("GET /", s.portada)
	// Las cabeceras van en una sola capa: si cada manejador pusiera las suyas,
	// la que se olvidara no fallaría ninguna prueba hasta que alguien mirara.
	return conCabeceras(mux)
}

// Las mismas que declaraba `next.config.ts`, en todas las respuestas.
func conCabeceras(siguiente http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h := w.Header()
		h.Set("X-Frame-Options", "DENY")
		h.Set("X-Content-Type-Options", "nosniff")
		h.Set("Referrer-Policy", "no-referrer")
		h.Set("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=()")
		h.Set("Cross-Origin-Opener-Policy", "same-origin")
		h.Set("Strict-Transport-Security", "max-age=31536000")
		siguiente.ServeHTTP(w, r)
	})
}

// csp devuelve la política y el nonce de ESTA respuesta. Va sólo en el HTML,
// como el middleware de Next, que excluye /api de su matcher.
//
// Sin `unsafe-eval`: en desarrollo Next lo añadía, y aquí no hay desarrollo que
// valga —el binario que se prueba es el que se despliega—.
func csp() (string, string) {
	crudo := make([]byte, 16)
	if _, err := rand.Read(crudo); err != nil {
		return "", ""
	}
	nonce := base64.StdEncoding.EncodeToString(crudo)
	return strings.Join([]string{
		"default-src 'self'",
		"script-src 'self' 'nonce-" + nonce + "' 'strict-dynamic'",
		"style-src 'self' 'unsafe-inline'",
		"img-src 'self' data:",
		"font-src 'self'",
		"connect-src 'self'",
		"object-src 'none'",
		"base-uri 'none'",
		"form-action 'self'",
		"frame-ancestors 'none'",
	}, "; "), nonce
}

func (s *Server) html(w http.ResponseWriter, estado int) string {
	politica, nonce := csp()
	h := w.Header()
	h.Set("Content-Type", "text/html; charset=utf-8")
	h.Set("Cache-Control", "no-store")
	if politica != "" {
		h.Set("Content-Security-Policy", politica)
	}
	w.WriteHeader(estado)
	return nonce
}

// salud no consume nada ni enseña configuración: sólo dice que se está en pie.
// En Node esto se hacía pidiendo un id de secreto inventado y esperando un 404.
func (s *Server) salud(w http.ResponseWriter, r *http.Request) {
	escribirJSON(w, http.StatusOK, map[string]any{"ok": true})
}

// portada: el documento entero. La sesión la decide el servidor, que es quien
// tiene la cookie; el navegador no puede deducir «hay sesión» por su cuenta sin
// inventarse una respuesta que sólo el servidor puede dar.
//
// El enlace de alta sale del ENTORNO y de ninguna constante. Estuvo escrito a
// fuego apuntando al proveedor de quien escribió esto, en un repositorio con
// licencia MIT: cualquiera que lo desplegara le ponía a sus visitantes un botón
// de alta hacia el Authentik de un desconocido. Sin variable no hay botón.
func (s *Server) portada(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path != "/" {
		escribirJSON(w, http.StatusNotFound, map[string]any{"error": "Not found"})
		return
	}
	pantalla, correo := "landing", ""
	if cuenta := s.cuenta(r); cuenta != nil {
		pantalla, correo = "tool", cuenta.Email
	}
	s.documento(w, r, datos{
		Pagina: pantalla, Email: correo,
		Titulo:      "SecretDrop — one-time secrets, encrypted in your browser",
		Descripcion: "Share a password once: encrypted before it leaves your browser, burned the moment it is read. The server only ever sees ciphertext. Self-hosted and open source.",
		Canonica:    s.canonica("/"),
	})
}

// visor: la pantalla que descifra. **No lee ni consume el almacén.** El consumo
// es la petición explícita del visor a /api/secrets/<id>, y sin clave en el
// fragmento no llega a hacerla. Renderizar aquí convertiría abrir un enlace
// —o que lo abriera un previsualizador de mensajería— en gastar el secreto.
//
// `noindex` va en el documento: un enlace de un solo uso no se indexa. Y el id
// se valida aquí, para que el visor no tenga que volver a fiarse de la URL.
func (s *Server) visor(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if !store.ValidID(id) {
		id = ""
	}
	s.documento(w, r, datos{
		Pagina: "viewer", SecretID: id, NoIndex: true,
		Titulo:      "SecretDrop",
		Descripcion: "A one-time secret, decrypted in your browser.",
	})
}

func (s *Server) robots(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	_, _ = io.WriteString(w, "User-agent: *\nAllow: /$\nDisallow: /v/\n")
}

func (s *Server) canonica(ruta string) string {
	if s.publicHost == "" {
		return ""
	}
	return "https://" + s.publicHost + ruta
}

type datos struct {
	Pagina, Email, SecretID    string
	Titulo, Descripcion        string
	Canonica                   string
	NoIndex                    bool
	Nonce, JS, Alta, CuentaURL string
	Footer                     bool
	CSS                        []string
}

func (s *Server) documento(w http.ResponseWriter, r *http.Request, d datos) {
	d.Nonce = s.html(w, http.StatusOK)
	d.JS, d.CSS = s.recursos.JS, s.recursos.CSS
	d.Alta = os.Getenv("SECRETDROP_ENROLL_URL")
	d.CuentaURL = os.Getenv("SECRETDROP_ACCOUNT_URL")
	// El pie común enseña los enlaces al resto de servicios sólo si el
	// despliegue los pide. En Next lo leía el propio componente, que allí es de
	// servidor; aquí el componente corre en el navegador y no tiene entorno, así
	// que la decisión la toma el servidor y viaja como atributo.
	d.Footer = strings.TrimSpace(os.Getenv("KAICORP_FOOTER_LINKS")) != ""
	_ = plantilla.Execute(w, d)
}

// html/template y no concatenación: escapa por contexto, así que ni una
// variable de entorno rara ni un id pueden salirse de su atributo.
var plantilla = template.Must(template.New("doc").Parse(
	`<!doctype html><html lang="en" class="h-full antialiased"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{{.Titulo}}</title>
<meta name="description" content="{{.Descripcion}}">
{{if .NoIndex}}<meta name="robots" content="noindex, nofollow">{{end}}
{{if .Canonica}}<link rel="canonical" href="{{.Canonica}}">
<meta property="og:url" content="{{.Canonica}}">{{end}}
<meta property="og:title" content="{{.Titulo}}">
<meta property="og:description" content="{{.Descripcion}}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="SecretDrop">
<meta name="twitter:card" content="summary_large_image">
{{range .CSS}}<link rel="stylesheet" href="{{.}}">
{{end}}</head>
<body class="min-h-full flex flex-col bg-background text-foreground">
<div id="app" data-page="{{.Pagina}}"{{if .Email}} data-email="{{.Email}}"{{end}}{{if .SecretID}} data-secret-id="{{.SecretID}}"{{end}}{{if .Alta}} data-enroll-url="{{.Alta}}"{{end}}{{if .CuentaURL}} data-account-url="{{.CuentaURL}}"{{end}}{{if .Footer}} data-footer-links="on"{{end}}></div>
{{if .JS}}<script type="module" nonce="{{.Nonce}}" src="{{.JS}}"></script>{{end}}
</body></html>
`))

func (s *Server) listar(w http.ResponseWriter, r *http.Request) {
	cuenta := s.exigirCuenta(w, r)
	if cuenta == nil {
		return
	}
	vivos := s.store.List(cuenta.Sub)
	lista := make([]map[string]any, 0, len(vivos))
	for _, m := range vivos {
		lista = append(lista, map[string]any{
			"id": m.ID, "expiresAt": m.ExpiresAt, "maxViews": m.MaxViews,
			"viewCount": m.ViewCount, "createdAt": m.CreatedAt,
		})
	}
	escribirJSON(w, http.StatusOK, map[string]any{"secrets": lista})
}

// enRango replica el de Node: sólo un número sirve; cualquier otra cosa cae al
// valor por omisión. Con `Math.max` a secas, un `ttlHours: "foo"` daba NaN y
// `expiresAt` quedaba en NaN — y como `NaN < ahora` es siempre falso, el
// secreto no caducaba nunca.
func enRango(valor any, min, max, porDefecto float64) int64 {
	n, ok := valor.(float64)
	if !ok || math.IsNaN(n) || math.IsInf(n, 0) {
		return int64(porDefecto)
	}
	n = math.Floor(n)
	return int64(math.Min(math.Max(n, min), max))
}

// tipoJSON replica /^application\/json\s*(;|$)/i sobre la cabecera recortada.
func tipoJSON(tipo string) bool {
	t := strings.ToLower(strings.TrimSpace(tipo))
	if !strings.HasPrefix(t, "application/json") {
		return false
	}
	resto := strings.TrimLeft(t[len("application/json"):], " \t")
	return resto == "" || strings.HasPrefix(resto, ";")
}

func (s *Server) crear(w http.ResponseWriter, r *http.Request) {
	if s.limitar(w, r, "create:", 60, time.Hour) {
		return
	}
	cuenta := s.exigirCuenta(w, r)
	if cuenta == nil {
		return
	}
	crudo, err := io.ReadAll(io.LimitReader(r.Body, maxCuerpo+1))
	if err != nil || len(crudo) > maxCuerpo {
		escribirJSON(w, http.StatusRequestEntityTooLarge, map[string]any{"error": "Secret too large"})
		return
	}
	// Se exige `application/json`, y no es formalismo. Los servicios de este
	// dominio son el MISMO sitio para el navegador, así que la cookie viaja en
	// una petición lanzada desde cualquiera de ellos. El navegador sólo deja
	// salir sin preguntar si el tipo es `text/plain`, `multipart/form-data` o
	// el de un formulario; con `application/json` está obligado a preguntar, y
	// esa pregunta aquí no se contesta.
	if !tipoJSON(r.Header.Get("content-type")) {
		escribirJSON(w, http.StatusBadRequest, map[string]any{"error": "Malformed request body"})
		return
	}
	// Un objeto, y sólo un objeto: `null` es JSON válido y una lista también,
	// y las dos dejaban los campos en nada sin decir por qué.
	var cuerpo map[string]any
	if len(crudo) == 0 || json.Unmarshal(crudo, &cuerpo) != nil || cuerpo == nil {
		escribirJSON(w, http.StatusBadRequest, map[string]any{"error": "Malformed request body"})
		return
	}
	ciphertext, okC := cuerpo["ciphertext"].(string)
	iv, okI := cuerpo["iv"].(string)
	if !okC || !okI || ciphertext == "" || iv == "" {
		escribirJSON(w, http.StatusBadRequest, map[string]any{"error": "Missing ciphertext or iv"})
		return
	}
	// La longitud se mide como la mide JavaScript —unidades UTF-16— porque el
	// tope está escrito contra `string.length`, no contra bytes.
	if len([]rune(ciphertext)) > maxCiphertext || len([]rune(iv)) > maxIV {
		escribirJSON(w, http.StatusRequestEntityTooLarge, map[string]any{"error": "Secret too large"})
		return
	}
	ttl := enRango(cuerpo["ttlHours"], 1, 168, 24)
	vistas := enRango(cuerpo["maxViews"], 1, 10, 1)

	ahora := s.now().UnixMilli()
	id, err := store.NewID()
	if err != nil {
		escribirJSON(w, http.StatusInternalServerError, map[string]any{"error": "Failed to create secret"})
		return
	}
	meta := store.Meta{
		ID: id, Ciphertext: ciphertext, IV: iv, Owner: cuenta.Sub,
		ExpiresAt: ahora + ttl*3600_000, MaxViews: int(vistas), ViewCount: 0,
		CreatedAt: ahora, Burned: false,
	}
	switch err := s.store.Create(meta); {
	case errors.Is(err, store.ErrQuota):
		escribirJSON(w, http.StatusInsufficientStorage, map[string]any{"error": "Secret store is full"})
	case err != nil:
		escribirJSON(w, http.StatusInternalServerError, map[string]any{"error": "Failed to create secret"})
	default:
		escribirJSON(w, http.StatusOK, map[string]any{
			"id": meta.ID, "expiresAt": meta.ExpiresAt, "maxViews": meta.MaxViews,
		})
	}
}

func (s *Server) consumir(w http.ResponseWriter, r *http.Request) {
	if s.limitar(w, r, "read:", 120, time.Minute) {
		return
	}
	// Leer NO pide cuenta: quien recibe el enlace no tiene por qué tenerla.
	id := r.PathValue("id")
	meta, err := s.store.Consume(id)
	switch {
	case errors.Is(err, store.ErrNotFound):
		escribirJSON(w, http.StatusNotFound, map[string]any{"error": "Secret not found"})
	case errors.Is(err, store.ErrExpired):
		escribirJSON(w, http.StatusGone, map[string]any{"error": "Secret expired"})
	case errors.Is(err, store.ErrBurned):
		escribirJSON(w, http.StatusGone, map[string]any{"error": "Secret already burned"})
	case err != nil:
		escribirJSON(w, http.StatusServiceUnavailable, map[string]any{"error": "Secret could not be consumed safely"})
	default:
		escribirJSON(w, http.StatusOK, map[string]any{
			"id": meta.ID, "ciphertext": meta.Ciphertext, "iv": meta.IV,
			"expiresAt": meta.ExpiresAt, "maxViews": meta.MaxViews,
			"viewCount": meta.ViewCount, "burned": meta.Burned,
		})
	}
}

func (s *Server) limpiar(w http.ResponseWriter, r *http.Request) {
	if !s.mismoOrigen(r) {
		escribirJSON(w, http.StatusForbidden, map[string]any{"error": "Cross-origin request refused"})
		return
	}
	if s.exigirCuenta(w, r) == nil {
		return
	}
	escribirJSON(w, http.StatusOK, map[string]any{
		"deleted": s.store.CleanupExpired(), "timestamp": s.now().UnixMilli(),
	})
}

// mismoOrigen: Fetch Metadata primero, y sin `Origin` se deja pasar, que es lo
// que permite a curl y a las suites llegar. Sin navegador no hay cookie ajena
// que aprovechar.
func (s *Server) mismoOrigen(r *http.Request) bool {
	if site := r.Header.Get("sec-fetch-site"); site != "" && site != "same-origin" && site != "none" {
		return false
	}
	origen := r.Header.Get("origin")
	if origen == "" {
		return true
	}
	host := s.publicHost
	if host == "" {
		host = r.Host
	}
	return strings.HasSuffix(origen, "://"+host)
}
