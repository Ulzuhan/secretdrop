package auth

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

const secreto = "secreto-de-pruebas-secretdrop-32-bytes-minimo"

func acunar(t *testing.T, claves map[string]any, conSecreto string) string {
	t.Helper()
	crudo, err := json.Marshal(claves)
	if err != nil {
		t.Fatal(err)
	}
	carga := base64.RawURLEncoding.EncodeToString(crudo)
	mac := hmac.New(sha256.New, []byte(conSecreto))
	mac.Write([]byte(carga))
	return carga + "." + base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
}

func viva() map[string]any {
	return map[string]any{
		"sub": "sub-pruebas", "email": "pruebas@example.invalid",
		"exp": float64(time.Now().Add(time.Hour).UnixMilli()),
		"iat": float64(time.Now().UnixMilli()),
	}
}

func TestLaCookieBuenaEntraYLasDemasNo(t *testing.T) {
	v := NewVerifier(secreto, 12*time.Hour, t.TempDir())
	if cuenta := v.Account(acunar(t, viva(), secreto)); cuenta == nil || cuenta.Sub != "sub-pruebas" {
		t.Fatal("una cookie válida no entró")
	}
	caducada := viva()
	caducada["exp"] = float64(time.Now().Add(-time.Minute).UnixMilli())
	sinSub := viva()
	delete(sinSub, "sub")
	sinEmail := viva()
	delete(sinEmail, "email")
	sinExp := viva()
	delete(sinExp, "exp")

	for nombre, token := range map[string]string{
		"caducada":            acunar(t, caducada, secreto),
		"sin sub":             acunar(t, sinSub, secreto),
		"sin email":           acunar(t, sinEmail, secreto),
		"sin exp":             acunar(t, sinExp, secreto),
		"con otro secreto":    acunar(t, viva(), "otro-secreto-distinto-de-32-bytes-min"),
		"vacía":               "",
		"sin punto":           "solocarga",
		"con la firma vacía":  "carga.",
		"con la carga vacía":  ".firma",
		"que no es base64url": "no-es-base64!!.firma",
	} {
		if v.Account(token) != nil {
			t.Fatalf("entró una cookie que no debía: %s", nombre)
		}
	}
}

// La firma se comprueba sobre los BYTES RECIBIDOS. Un verificador que
// decodifique, reserialice y luego firme aceptaría cualquier reordenación o
// espaciado que produzca el mismo objeto.
func TestLaFirmaVaSobreLosBytesRecibidos(t *testing.T) {
	v := NewVerifier(secreto, 12*time.Hour, t.TempDir())
	token := acunar(t, viva(), secreto)
	dot := strings.LastIndex(token, ".")
	carga, firma := token[:dot], token[dot+1:]
	// Se recodifica la MISMA carga con otro espaciado y se le pega la firma
	// original.
	crudo, err := base64.RawURLEncoding.DecodeString(carga)
	if err != nil {
		t.Fatal(err)
	}
	var objeto map[string]any
	if err := json.Unmarshal(crudo, &objeto); err != nil {
		t.Fatal(err)
	}
	conEspacios, _ := json.MarshalIndent(objeto, "", " ")
	recodificada := base64.RawURLEncoding.EncodeToString(conEspacios)
	if v.Account(recodificada+"."+firma) != nil {
		t.Fatal("se aceptó una carga recodificada con la firma de la original")
	}
}

func TestUnaRevocacionInvalidaLoEmitidoAntes(t *testing.T) {
	dir := t.TempDir()
	v := NewVerifier(secreto, 12*time.Hour, dir)
	ahora := time.Now().UnixMilli()
	escribir := func(m map[string]int64) {
		crudo, _ := json.Marshal(m)
		if err := os.WriteFile(filepath.Join(dir, "revocaciones.json"), crudo, 0o600); err != nil {
			t.Fatal(err)
		}
		v.Olvidar()
	}

	antigua := viva()
	antigua["iat"] = float64(ahora - 60_000)
	posterior := viva()
	posterior["iat"] = float64(ahora + 60_000)

	escribir(map[string]int64{"sub-pruebas": ahora})
	if v.Account(acunar(t, antigua, secreto)) != nil {
		t.Fatal("una cookie emitida antes de la revocación siguió valiendo")
	}
	if v.Account(acunar(t, posterior, secreto)) == nil {
		t.Fatal("una cookie emitida después de la revocación debería valer")
	}

	// Una marca vieja ya no puede impedir nada: la propia cookie habría caducado.
	escribir(map[string]int64{"sub-pruebas": ahora - int64(26*time.Hour/time.Millisecond)})
	if v.Account(acunar(t, antigua, secreto)) == nil {
		t.Fatal("una marca de hace 26 h siguió revocando")
	}
}

// Sin fichero es primera instalación; un fichero ilegible NO es «no hay nada»:
// no puede reactivar permisos por un error de lectura.
func TestUnaListaIlegibleNoReactivaPermisos(t *testing.T) {
	dir := t.TempDir()
	v := NewVerifier(secreto, 12*time.Hour, dir)
	if v.Account(acunar(t, viva(), secreto)) == nil {
		t.Fatal("sin lista, una cookie válida debe entrar")
	}
	if err := os.WriteFile(filepath.Join(dir, "revocaciones.json"), []byte("{roto"), 0o600); err != nil {
		t.Fatal(err)
	}
	v.Olvidar()
	// Se vuelve a intentar en cada consulta en vez de darla por cargada y vacía.
	v.mu.Lock()
	cargadas := v.cargadas
	v.mu.Unlock()
	if cargadas {
		t.Fatal("una lista ilegible no debe darse por cargada")
	}
}
