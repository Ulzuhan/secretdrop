package httpapi

import (
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"
)

// Ventana deslizante en memoria, como la de Node: misma forma de respuesta y
// mismo `Retry-After`, porque las suites los comprueban.
type limiter struct {
	mu    sync.Mutex
	cubos map[string][]time.Time
	now   func() time.Time
}

func newLimiter() *limiter { return &limiter{cubos: map[string][]time.Time{}, now: time.Now} }

// permitir devuelve 0 si se puede seguir, o los segundos de `Retry-After`.
func (l *limiter) permitir(clave string, maximo int, ventana time.Duration) int {
	l.mu.Lock()
	defer l.mu.Unlock()
	ahora := l.now()
	var recientes []time.Time
	for _, t := range l.cubos[clave] {
		if ahora.Sub(t) < ventana {
			recientes = append(recientes, t)
		}
	}
	if len(recientes) >= maximo {
		l.cubos[clave] = recientes
		espera := int((ventana - ahora.Sub(recientes[0])).Seconds())
		if espera < 1 {
			espera = 1
		}
		return espera
	}
	l.cubos[clave] = append(recientes, ahora)
	return 0
}

// clientIP se queda con el ÚLTIMO valor de `x-forwarded-for`: el que añade el
// proxy de casa. Los anteriores los pone quien llama y no valen nada.
func clientIP(r *http.Request) string {
	valores := r.Header.Get("x-forwarded-for")
	if valores == "" {
		return "direct"
	}
	trozos := strings.Split(valores, ",")
	ultimo := strings.TrimSpace(trozos[len(trozos)-1])
	if ultimo == "" {
		return "direct"
	}
	return ultimo
}

func (s *Server) limitar(w http.ResponseWriter, r *http.Request, prefijo string, maximo int, ventana time.Duration) bool {
	if espera := s.limiter.permitir(prefijo+clientIP(r), maximo, ventana); espera > 0 {
		w.Header().Set("Retry-After", strconv.Itoa(espera))
		escribirJSON(w, http.StatusTooManyRequests, map[string]any{"error": "Too many requests"})
		return true
	}
	return false
}
