// Package httpapi sirve la API de secretos con la biblioteca estándar. Los
// cuerpos de error y los códigos son los mismos que en Node porque las suites
// los comprueban uno a uno: cambiar un texto aquí es cambiar el contrato.
package httpapi

import (
	"encoding/json"
	"errors"
	"io"
	"math"
	"net/http"
	"strings"
	"time"

	"github.com/Ulzuhan/secretdrop/internal/auth"
	"github.com/Ulzuhan/secretdrop/internal/store"
)

const (
	maxCiphertext = 256 * 1024
	maxIV         = 256
	// El cuerpo se lee acotado: esta ruta acepta hasta 256 KiB de criptograma,
	// y por encima de eso no hay nada legítimo que leer.
	maxCuerpo = maxCiphertext + 8*1024
)

type Server struct {
	store      *store.Store
	verifier   *auth.Verifier
	limiter    *limiter
	publicHost string
	now        func() time.Time
}

func New(s *store.Store, v *auth.Verifier, publicHost string) *Server {
	return &Server{store: s, verifier: v, limiter: newLimiter(), publicHost: publicHost, now: time.Now}
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
	mux.HandleFunc("GET /api/health", s.salud)
	mux.HandleFunc("GET /", s.portada)
	return mux
}

// salud no consume nada ni enseña configuración: sólo dice que se está en pie.
// En Node esto se hacía pidiendo un id de secreto inventado y esperando un 404.
func (s *Server) salud(w http.ResponseWriter, r *http.Request) {
	escribirJSON(w, http.StatusOK, map[string]any{"ok": true})
}

// portada: marco mínimo mientras la interfaz sigue siendo la de Next. La
// pantalla de React llega en la siguiente entrega; lo que importa ahora es que
// una ruta desconocida NO devuelva 200 con HTML, que es como una SPA mal
// servida esconde un 404 de API.
func (s *Server) portada(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path != "/" {
		escribirJSON(w, http.StatusNotFound, map[string]any{"error": "Not found"})
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Referrer-Policy", "no-referrer")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	_, _ = io.WriteString(w, "<!doctype html><meta charset=utf-8><title>SecretDrop</title>")
}

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
