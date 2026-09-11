package main

import (
	"context"
	"io"
	"net"
	"net/http"
	"testing"
	"time"
)

// Una petición en vuelo tiene que terminar cuando llega la señal de parada.
// Antes de la 0.9.1 no era así: el proceso dejaba de admitir y volvía de
// inmediato, sin esperar al drenaje. Con secretos de un solo uso, una entrega
// cortada a medias es peor que un error: el consumo ya está escrito.
func TestServirEsperaAlDrenaje(t *testing.T) {
	escucha, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("no se pudo escuchar: %v", err)
	}

	empezada := make(chan struct{})
	soltar := make(chan struct{})
	mux := http.NewServeMux()
	mux.HandleFunc("/lenta", func(w http.ResponseWriter, r *http.Request) {
		close(empezada)
		<-soltar
		_, _ = io.WriteString(w, "entregado")
	})

	srv := &http.Server{Handler: mux}
	ctx, parar := context.WithCancel(context.Background())
	defer parar()

	vuelto := make(chan error, 1)
	go func() { vuelto <- servir(ctx, srv, escucha, 10*time.Second) }()

	respuesta := make(chan *http.Response, 1)
	fallo := make(chan error, 1)
	go func() {
		r, err := http.Get("http://" + escucha.Addr().String() + "/lenta")
		if err != nil {
			fallo <- err
			return
		}
		respuesta <- r
	}()

	select {
	case <-empezada:
	case err := <-fallo:
		t.Fatalf("la petición no llegó a empezar: %v", err)
	case <-time.After(5 * time.Second):
		t.Fatal("la petición no llegó a empezar")
	}

	parar() // lo que hace SIGTERM en el contenedor

	select {
	case err := <-vuelto:
		t.Fatalf("servir volvió con una petición en vuelo (err=%v)", err)
	case <-time.After(250 * time.Millisecond):
	}

	close(soltar)

	select {
	case r := <-respuesta:
		defer r.Body.Close()
		cuerpo, _ := io.ReadAll(r.Body)
		if r.StatusCode != http.StatusOK || string(cuerpo) != "entregado" {
			t.Fatalf("la respuesta en vuelo no llegó entera: %d %q", r.StatusCode, cuerpo)
		}
	case err := <-fallo:
		t.Fatalf("la respuesta en vuelo se cortó: %v", err)
	case <-time.After(5 * time.Second):
		t.Fatal("la respuesta en vuelo no llegó")
	}

	select {
	case err := <-vuelto:
		if err != nil {
			t.Fatalf("servir devolvió error: %v", err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("servir no volvió después de drenar")
	}
}

// El drenaje no puede eternizarse: pasado el plazo, Shutdown vuelve aunque la
// petición siga colgada, y servir con él. El runtime no espera indefinidamente.
func TestServirRespetaElPlazo(t *testing.T) {
	escucha, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("no se pudo escuchar: %v", err)
	}

	empezada := make(chan struct{})
	colgada := make(chan struct{})
	defer close(colgada)
	mux := http.NewServeMux()
	mux.HandleFunc("/colgada", func(w http.ResponseWriter, r *http.Request) {
		close(empezada)
		<-colgada
	})

	srv := &http.Server{Handler: mux}
	ctx, parar := context.WithCancel(context.Background())
	defer parar()

	vuelto := make(chan error, 1)
	go func() { vuelto <- servir(ctx, srv, escucha, 300*time.Millisecond) }()
	go func() {
		r, err := http.Get("http://" + escucha.Addr().String() + "/colgada")
		if err == nil {
			r.Body.Close()
		}
	}()

	select {
	case <-empezada:
	case <-time.After(5 * time.Second):
		t.Fatal("la petición no llegó a empezar")
	}
	parar()

	select {
	case err := <-vuelto:
		if err != nil {
			t.Fatalf("servir devolvió error: %v", err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("servir se quedó esperando más allá del plazo de drenaje")
	}
}
