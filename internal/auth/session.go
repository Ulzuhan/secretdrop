// Package auth verifica la sesión y la lista de revocación. No emite cookies
// todavía: el inicio de sesión por OIDC llega en la siguiente entrega.
package auth

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

const CookieName = "secretdrop_session"

// RevocationTTL: más allá una marca ya no puede impedir nada, porque la propia
// cookie habría caducado.
const RevocationTTL = 25 * time.Hour

type Account struct {
	Sub   string `json:"sub"`
	Email string `json:"email"`
	Name  string `json:"name,omitempty"`
}

type claims struct {
	Sub   string   `json:"sub"`
	Email string   `json:"email"`
	Name  string   `json:"name"`
	Exp   *float64 `json:"exp"`
	Iat   *float64 `json:"iat"`
}

type Verifier struct {
	secret    []byte
	ttl       time.Duration
	storeDir  string
	mu        sync.Mutex
	revocadas map[string]int64
	cargadas  bool
	now       func() time.Time
}

func NewVerifier(secret string, ttl time.Duration, storeDir string) *Verifier {
	return &Verifier{secret: []byte(secret), ttl: ttl, storeDir: storeDir, now: time.Now}
}

func (v *Verifier) firmar(payload string) string {
	mac := hmac.New(sha256.New, v.secret)
	mac.Write([]byte(payload))
	return base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
}

// Account lee la cookie. Devuelve nil si no es de fiar, sin decir por qué: al
// cliente le da igual y al atacante también.
//
// La firma se comprueba sobre los BYTES RECIBIDOS, no sobre el JSON vuelto a
// serializar. Decodificar, reserializar y luego verificar aceptaría cualquier
// reordenación o espaciado que produjera el mismo objeto.
func (v *Verifier) Account(token string) *Account {
	if len(v.secret) == 0 || token == "" {
		return nil
	}
	dot := strings.LastIndex(token, ".")
	if dot <= 0 {
		return nil
	}
	payload, provided := token[:dot], token[dot+1:]

	// Tiempo constante: una comparación normal filtra la firma byte a byte por
	// lo que tarda en contestar.
	if !hmac.Equal([]byte(provided), []byte(v.firmar(payload))) {
		return nil
	}

	crudo, err := base64.RawURLEncoding.DecodeString(payload)
	if err != nil {
		return nil
	}
	var c claims
	if json.Unmarshal(crudo, &c) != nil {
		return nil
	}
	ahora := v.now().UnixMilli()
	if c.Exp == nil || int64(*c.Exp) <= ahora {
		return nil
	}
	if c.Sub == "" || c.Email == "" {
		return nil
	}
	// Las cookies emitidas antes de que existiera `iat` se fechan por su
	// caducidad: se emitieron una vida de sesión antes. En el peor caso revoca
	// de más, que es el lado bueno por el que equivocarse.
	emitida := int64(*c.Exp) - v.ttl.Milliseconds()
	if c.Iat != nil {
		emitida = int64(*c.Iat)
	}
	if v.revocadaDespuesDe(c.Sub, emitida) {
		return nil
	}
	return &Account{Sub: c.Sub, Email: c.Email, Name: c.Name}
}

func (v *Verifier) archivo() string { return filepath.Join(v.storeDir, "revocaciones.json") }

// revocadaDespuesDe: una marca invalida todo lo emitido HASTA ese momento.
//
// No poder leer la lista no tumba la aplicación, pero tampoco se trata un
// fichero ilegible como «no hay nada»: se distingue de la primera instalación
// para no reactivar permisos por un error de lectura.
func (v *Verifier) revocadaDespuesDe(sub string, emitida int64) bool {
	v.mu.Lock()
	defer v.mu.Unlock()
	if !v.cargadas {
		v.revocadas = map[string]int64{}
		crudo, err := os.ReadFile(v.archivo())
		switch {
		case err == nil:
			var leidas map[string]int64
			if json.Unmarshal(crudo, &leidas) == nil {
				limite := v.now().Add(-RevocationTTL).UnixMilli()
				for k, cuando := range leidas {
					if cuando >= limite {
						v.revocadas[k] = cuando
					}
				}
				v.cargadas = true
			}
			// Ilegible: no se marca como cargada, se reintenta a la siguiente.
		case os.IsNotExist(err):
			v.cargadas = true // primera instalación: no hay nada que leer
		}
	}
	cuando, hay := v.revocadas[sub]
	return hay && emitida <= cuando
}

// Olvidar vuelve a leer la lista del disco. La usa el aviso de cierre tras
// escribirla, y las pruebas.
func (v *Verifier) Olvidar() {
	v.mu.Lock()
	v.cargadas = false
	v.mu.Unlock()
}
