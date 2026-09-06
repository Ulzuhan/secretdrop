// secretdrop: un solo proceso que sirve la API. La configuración llega por las
// mismas variables `SECRETDROP_*` que ya usa el compose, para que el port no
// cambie nada de la infraestructura.
package main

import (
	"context"
	"errors"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"syscall"
	"time"

	"github.com/Ulzuhan/secretdrop/internal/auth"
	"github.com/Ulzuhan/secretdrop/internal/httpapi"
	"github.com/Ulzuhan/secretdrop/internal/store"
)

func entero(nombre string, porDefecto, min, max int64) int64 {
	crudo := os.Getenv(nombre)
	if crudo == "" {
		return porDefecto
	}
	// Una variable presente pero vacía o ilegible cae al valor por omisión, no
	// a cero: `SECRETDROP_SESSION_TTL_HOURS=` daría sesiones de nada.
	n, err := strconv.ParseInt(crudo, 10, 64)
	if err != nil || n <= 0 {
		return porDefecto
	}
	if n < min {
		return min
	}
	if n > max {
		return max
	}
	return n
}

func main() {
	dir := os.Getenv("SECRETDROP_STORE_DIR")
	if dir == "" {
		dir = ".secretdrop-store"
	}
	secreto := os.Getenv("SECRETDROP_SESSION_SECRET")
	if secreto == "" {
		log.Fatal("SECRETDROP_SESSION_SECRET is not set")
	}
	ttl := time.Duration(entero("SECRETDROP_SESSION_TTL_HOURS", 12, 1, 24)) * time.Hour
	maxBytes := entero("SECRETDROP_MAX_STORE_BYTES", 100*1024*1024, 1, 1<<62)
	maxActive := entero("SECRETDROP_MAX_ACTIVE_SECRETS", 1000, 1, 1<<31)

	if err := os.MkdirAll(dir, 0o700); err != nil {
		log.Fatalf("no se pudo preparar el almacén: %v", err)
	}
	almacen := store.New(dir, maxBytes, int(maxActive))
	// Antes de escuchar, y no en paralelo: el índice tiene que estar completo
	// cuando llegue el primer listado. En Node esto se lanzaba sin esperarlo y
	// con 2000 registros el primer listado devolvía 1606.
	if err := almacen.Hydrate(); err != nil {
		log.Fatalf("no se pudo leer el almacén: %v", err)
	}

	verificador := auth.NewVerifier(secreto, ttl, dir)
	// Sin configuración de identidad la aplicación arranca igual: leer un
	// secreto por su enlace nunca ha pedido cuenta. Lo que no habrá es entrada.
	oidc := auth.OidcFromEnv()
	if oidc == nil {
		log.Print("aviso: sin configuración OIDC; no se podrá iniciar sesión")
	}
	servidor := httpapi.New(almacen, verificador, oidc, auth.NewDiscovery(),
		os.Getenv("SECRETDROP_PUBLIC_HOST"))

	host := os.Getenv("HOSTNAME")
	if host == "" {
		host = "127.0.0.1"
	}
	puerto := os.Getenv("PORT")
	if puerto == "" {
		puerto = "3461"
	}
	direccion := net.JoinHostPort(host, puerto)

	http1 := &http.Server{
		Addr:              direccion,
		Handler:           servidor.Handler(),
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       30 * time.Second,
		WriteTimeout:      30 * time.Second,
		IdleTimeout:       60 * time.Second,
	}

	// Parada ordenada: se deja de admitir y se drena con plazo. Un consumo a
	// medio persistir no se puede cortar en seco sin arriesgar entregar sin
	// dejar constancia.
	ctx, parar := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer parar()
	go func() {
		<-ctx.Done()
		cierre, cancelar := context.WithTimeout(context.Background(), 15*time.Second)
		defer cancelar()
		_ = http1.Shutdown(cierre)
	}()

	log.Printf("secretdrop escuchando en %s, almacén %s", direccion, dir)
	if err := http1.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Fatal(err)
	}
}
