package httpapi

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"

	"github.com/Ulzuhan/secretdrop/internal/auth"
)

const cookieOidc = "secretdrop_oidc"

// cookieSegura decide el atributo `Secure`, y lo hace al revés que Node **a
// propósito**.
//
// Node lo ata a `NODE_ENV === "production"`, que su imagen trae puesto de
// fábrica. Un binario Go no lo trae, y el compose de la casa tampoco lo pasa:
// copiar esa condición habría emitido cookies SIN `Secure` en producción el día
// del despliegue, sin que fallara ninguna prueba. Un fallo así no avisa.
//
// Así que aquí van seguras salvo que alguien lo desactive a mano, que es lo que
// necesita quien sirva esto por http en local. Equivocarse por el lado de
// exigir https es el lado bueno.
func cookieSegura() bool { return os.Getenv("SECRETDROP_INSECURE_COOKIES") != "1" }

type estadoOidc struct {
	Verifier string `json:"verifier"`
	State    string `json:"state"`
	Next     string `json:"next"`
}

func (s *Server) ponerCookie(w http.ResponseWriter, nombre, valor string, maxAge int) {
	http.SetCookie(w, &http.Cookie{
		Name: nombre, Value: valor, Path: "/", HttpOnly: true,
		Secure: cookieSegura(), SameSite: http.SameSiteLaxMode, MaxAge: maxAge,
	})
}

func (s *Server) borrarCookie(w http.ResponseWriter, nombre string) {
	http.SetCookie(w, &http.Cookie{
		Name: nombre, Value: "", Path: "/", HttpOnly: true,
		Secure: cookieSegura(), SameSite: http.SameSiteLaxMode, MaxAge: -1,
	})
}

func (s *Server) login(w http.ResponseWriter, r *http.Request) {
	if s.oidc == nil {
		escribirJSON(w, http.StatusServiceUnavailable,
			map[string]any{"error": "Sign-in is not configured on this instance"})
		return
	}
	verifier, err := auth.NewVerifier43()
	if err != nil {
		escribirJSON(w, http.StatusInternalServerError, map[string]any{"error": "Sign-in unavailable"})
		return
	}
	state, err := auth.NewVerifier43()
	if err != nil {
		escribirJSON(w, http.StatusInternalServerError, map[string]any{"error": "Sign-in unavailable"})
		return
	}
	// Sólo rutas internas: un enlace con ?next=https://otro convertiría el
	// inicio de sesión en un redirector a donde quisiera quien lo mandara.
	next := auth.SafeNext(r.URL.Query().Get("next"))

	destino, err := s.discovery.AuthorizeURL(r.Context(), s.oidc, state, auth.ChallengeFor(verifier))
	if err != nil {
		escribirJSON(w, http.StatusServiceUnavailable, map[string]any{"error": "Sign-in unavailable"})
		return
	}
	guardado, err := json.Marshal(estadoOidc{Verifier: verifier, State: state, Next: next})
	if err != nil {
		escribirJSON(w, http.StatusInternalServerError, map[string]any{"error": "Sign-in unavailable"})
		return
	}
	// URL-encoded, como lo deja Next. El valor es JSON, y `{`, `"` y `,` no son
	// bytes válidos de cookie: `http.SetCookie` los BORRA en silencio y lo que
	// llega de vuelta ya no es JSON. Además así una cookie emitida por Node
	// durante una migración se sigue leyendo aquí.
	//
	// `lax` y no `strict`: la vuelta desde el proveedor es una navegación entre
	// sitios para el navegador, y con `strict` retendría la cookie.
	s.ponerCookie(w, cookieOidc, url.QueryEscape(string(guardado)), 10*60)
	http.Redirect(w, r, destino, http.StatusTemporaryRedirect)
}

func (s *Server) callback(w http.ResponseWriter, r *http.Request) {
	volver := func(ruta string) {
		w.Header().Set("Location", ruta)
		w.WriteHeader(http.StatusFound)
	}
	fallo := func() {
		s.borrarCookie(w, cookieOidc)
		volver("/?error=signin")
	}
	if s.oidc == nil {
		volver("/")
		return
	}
	code := r.URL.Query().Get("code")
	state := r.URL.Query().Get("state")
	var guardado estadoOidc
	if c, err := r.Cookie(cookieOidc); err == nil {
		crudo, err := url.QueryUnescape(c.Value)
		if err != nil {
			crudo = c.Value // por si alguna vez llegara sin codificar
		}
		_ = json.Unmarshal([]byte(crudo), &guardado)
	}
	// El `state` tiene que ser el que emitimos: es lo que impide que alguien
	// nos haga iniciar sesión con SU código.
	if code == "" || state == "" || guardado.State == "" || guardado.Verifier == "" || state != guardado.State {
		fallo()
		return
	}
	identidad, err := s.discovery.ExchangeCode(r.Context(), s.oidc, code, guardado.Verifier)
	if err != nil {
		fallo()
		return
	}
	token := s.verifier.Issue(*identidad)
	if token == "" {
		fallo()
		return
	}
	s.ponerCookie(w, auth.CookieName, token, int(s.verifier.TTL().Seconds()))
	s.borrarCookie(w, cookieOidc)
	volver(auth.SafeNext(guardado.Next))
}

func (s *Server) logout(w http.ResponseWriter, r *http.Request) {
	if !s.mismoOrigen(r) {
		escribirJSON(w, http.StatusForbidden, map[string]any{"error": "Cross-origin request refused"})
		return
	}
	s.borrarCookie(w, auth.CookieName)
	next := "/"
	if s.oidc != nil {
		if e, err := s.discovery.Discover(r.Context(), s.oidc); err == nil && e.EndSession != "" {
			next = e.EndSession
		}
	}
	escribirJSON(w, http.StatusOK, map[string]any{"ok": true, "next": next})
}

// backchannelLogout: el proveedor avisa de que alguien ha cerrado sesión.
// Público y sin autenticar por definición, así que el cuerpo va acotado.
func (s *Server) backchannelLogout(w http.ResponseWriter, r *http.Request) {
	if s.backchannel == nil {
		escribirJSON(w, http.StatusNotFound, map[string]any{"error": "not_configured"})
		return
	}
	if !tipoFormulario(r.Header.Get("content-type")) {
		escribirJSON(w, http.StatusBadRequest, map[string]any{"error": "unsupported_media_type"})
		return
	}
	crudo, err := io.ReadAll(io.LimitReader(r.Body, 16*1024+1))
	if err != nil || len(crudo) > 16*1024 {
		escribirJSON(w, http.StatusRequestEntityTooLarge, map[string]any{"error": "payload_too_large"})
		return
	}
	valores, err := url.ParseQuery(string(crudo))
	if err != nil {
		escribirJSON(w, http.StatusBadRequest, map[string]any{"error": "missing logout_token"})
		return
	}
	token := valores.Get("logout_token")
	if token == "" {
		escribirJSON(w, http.StatusBadRequest, map[string]any{"error": "missing logout_token"})
		return
	}

	aviso, err := s.backchannel.Verificar(r.Context(), token)
	switch {
	case errors.Is(err, auth.ErrProveedor):
		// No se ha podido hablar con el proveedor para comprobar la firma: eso
		// es un fallo nuestro y sí merece que lo reintente.
		escribirJSON(w, http.StatusServiceUnavailable, map[string]any{"error": "verification unavailable"})
		return
	case err != nil:
		escribirJSON(w, http.StatusBadRequest, map[string]any{"error": "invalid logout_token"})
		return
	}

	// Aquí la cookie lleva el `sub` del proveedor y NO lleva `sid`: no hay
	// ninguna sesión que buscar por sesión. Responder 200 sería decir que se ha
	// echado a alguien que sigue dentro.
	if aviso.Sub == "" {
		escribirJSON(w, http.StatusBadRequest,
			map[string]any{"error": "unsupported logout_token: sid-only"})
		return
	}
	if err := s.verifier.Revocar(aviso.Sub); err != nil {
		// La revocación NO ha ocurrido: decirlo, para que lo reintente. Y no se
		// apunta el `jti`, para que ese reintento no llegue como repetido.
		escribirJSON(w, http.StatusServiceUnavailable,
			map[string]any{"error": "could not record revocation"})
		return
	}
	// Ya hay constancia en disco: a partir de aquí el aviso está gastado.
	s.backchannel.Aplicado(aviso.JTI)
	escribirJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func tipoFormulario(tipo string) bool {
	return strings.Contains(strings.ToLower(tipo), "application/x-www-form-urlencoded")
}
