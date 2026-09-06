package store

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"
)

func nuevoAlmacen(t *testing.T) *Store {
	t.Helper()
	s := New(t.TempDir(), 100*1024*1024, 1000)
	if err := s.Hydrate(); err != nil {
		t.Fatal(err)
	}
	return s
}

func sembrar(t *testing.T, s *Store, m Meta) Meta {
	t.Helper()
	if m.ID == "" {
		id, err := NewID()
		if err != nil {
			t.Fatal(err)
		}
		m.ID = id
	}
	if m.ExpiresAt == 0 {
		m.ExpiresAt = time.Now().Add(time.Hour).UnixMilli()
	}
	if m.MaxViews == 0 {
		m.MaxViews = 1
	}
	if m.Ciphertext == "" {
		m.Ciphertext = "Y0lQSEVSVEVYVE8="
	}
	if err := s.escribir(m); err != nil {
		t.Fatal(err)
	}
	return m
}

// Lo único que este almacén no puede permitirse: entregar un secreto de un solo
// uso a más de uno. Con la caché fría y treinta lectores a la vez es donde la
// implementación de Node se rompía al ensanchar su ventana a propósito.
func TestUnSoloUsoSeEntregaUnaVez(t *testing.T) {
	for vuelta := 0; vuelta < 20; vuelta++ {
		s := nuevoAlmacen(t)
		m := sembrar(t, s, Meta{MaxViews: 1})
		// Índice frío: todos los lectores llegan a la vez a leer disco.
		s.mu.Lock()
		delete(s.index, m.ID)
		s.mu.Unlock()

		var wg sync.WaitGroup
		entregas := make(chan string, 30)
		for i := 0; i < 30; i++ {
			wg.Add(1)
			go func() {
				defer wg.Done()
				if got, err := s.Consume(m.ID); err == nil {
					entregas <- got.Ciphertext
				}
			}()
		}
		wg.Wait()
		close(entregas)
		var n int
		for range entregas {
			n++
		}
		if n != 1 {
			t.Fatalf("vuelta %d: se entregó %d veces, no una", vuelta, n)
		}
	}
}

// Y el presupuesto de usos se respeta entero: tres usos, treinta lectores.
func TestElPresupuestoDeUsosNoSeDesborda(t *testing.T) {
	s := nuevoAlmacen(t)
	m := sembrar(t, s, Meta{MaxViews: 3})
	var wg sync.WaitGroup
	var mu sync.Mutex
	entregas := 0
	for i := 0; i < 30; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if _, err := s.Consume(m.ID); err == nil {
				mu.Lock()
				entregas++
				mu.Unlock()
			}
		}()
	}
	wg.Wait()
	if entregas != 3 {
		t.Fatalf("se entregó %d veces con presupuesto de 3", entregas)
	}
}

// La cuenta se persiste ANTES de entregar. Si se cayera justo después, el
// secreto queda consumido sin haberse entregado — que es el lado por el que
// hay que equivocarse.
func TestLaVistaSePersisteAntesDeEntregar(t *testing.T) {
	s := nuevoAlmacen(t)
	m := sembrar(t, s, Meta{MaxViews: 2})
	if _, err := s.Consume(m.ID); err != nil {
		t.Fatal(err)
	}
	crudo, err := os.ReadFile(filepath.Join(s.dir, m.ID, "meta.json"))
	if err != nil {
		t.Fatal(err)
	}
	var enDisco Meta
	if err := json.Unmarshal(crudo, &enDisco); err != nil {
		t.Fatal(err)
	}
	if enDisco.ViewCount != 1 {
		t.Fatalf("en disco la cuenta es %d, no 1", enDisco.ViewCount)
	}
}

// La lápida conserva la constancia y NO el secreto.
func TestElUltimoUsoDejaLapidaSinCriptograma(t *testing.T) {
	s := nuevoAlmacen(t)
	m := sembrar(t, s, Meta{MaxViews: 1})
	entregado, err := s.Consume(m.ID)
	if err != nil {
		t.Fatal(err)
	}
	if entregado.Ciphertext == "" {
		t.Fatal("no se entregó el criptograma al último lector")
	}
	crudo, _ := os.ReadFile(filepath.Join(s.dir, m.ID, "meta.json"))
	var enDisco Meta
	_ = json.Unmarshal(crudo, &enDisco)
	if enDisco.Ciphertext != "" || enDisco.IV != "" {
		t.Fatal("la lápida conserva el criptograma")
	}
	if !enDisco.Burned || enDisco.BurnedAt == 0 {
		t.Fatal("la lápida no está marcada")
	}
	if _, err := s.Consume(m.ID); err != ErrBurned {
		t.Fatalf("una lápida debe responder quemado, dio %v", err)
	}
}

func TestCaducadoYDesconocido(t *testing.T) {
	s := nuevoAlmacen(t)
	viejo := sembrar(t, s, Meta{ExpiresAt: time.Now().Add(-time.Hour).UnixMilli()})
	if _, err := s.Consume(viejo.ID); err != ErrExpired {
		t.Fatalf("un caducado debe dar expired, dio %v", err)
	}
	if _, err := s.Consume("noexisteaqu"); err != ErrNotFound {
		t.Fatal("un id corto debe dar not_found")
	}
	if _, err := s.Consume("../../../etc"); err != ErrNotFound {
		t.Fatal("un id con forma de ruta debe dar not_found")
	}
}

// El índice se llena desde disco antes de servir: ésta es la mitad Go de la
// carrera que Node perdía por lanzar el barrido sin esperarlo.
func TestHydrateDejaElListadoCompleto(t *testing.T) {
	dir := t.TempDir()
	previo := New(dir, 100*1024*1024, 10000)
	var ids []string
	for i := 0; i < 500; i++ {
		ids = append(ids, sembrar(t, previo, Meta{Owner: "sub-a", MaxViews: 5}).ID)
	}
	sembrar(t, previo, Meta{Owner: "sub-b"})
	sembrar(t, previo, Meta{}) // heredado, sin dueño

	fresco := New(dir, 100*1024*1024, 10000)
	if err := fresco.Hydrate(); err != nil {
		t.Fatal(err)
	}
	vivos := fresco.List("sub-a")
	if len(vivos) != len(ids) {
		t.Fatalf("el listado en frío trae %d de %d", len(vivos), len(ids))
	}
	for _, m := range vivos {
		if m.Ciphertext != "" {
			t.Fatal("el listado no puede llevar criptogramas")
		}
	}
}

// Hydrate purga lo caducado y las lápidas viejas, y respeta lo ajeno.
func TestHydratePurgaLoQueTocaYNadaMas(t *testing.T) {
	dir := t.TempDir()
	previo := New(dir, 100*1024*1024, 1000)
	vivo := sembrar(t, previo, Meta{Owner: "sub-a"})
	caducado := sembrar(t, previo, Meta{ExpiresAt: time.Now().Add(-time.Hour).UnixMilli()})
	lapidaVieja := sembrar(t, previo, Meta{Burned: true, Ciphertext: "-",
		BurnedAt: time.Now().Add(-8 * 24 * time.Hour).UnixMilli()})
	lapidaNueva := sembrar(t, previo, Meta{Burned: true, Ciphertext: "-",
		BurnedAt: time.Now().Add(-time.Hour).UnixMilli()})
	ajeno := filepath.Join(dir, "no-es-un-id-nuestro")
	if err := os.MkdirAll(ajeno, 0o700); err != nil {
		t.Fatal(err)
	}

	fresco := New(dir, 100*1024*1024, 1000)
	if err := fresco.Hydrate(); err != nil {
		t.Fatal(err)
	}
	existe := func(id string) bool {
		_, err := os.Stat(filepath.Join(dir, id, "meta.json"))
		return err == nil
	}
	if !existe(vivo.ID) || existe(caducado.ID) || existe(lapidaVieja.ID) || !existe(lapidaNueva.ID) {
		t.Fatal("la purga no dejó exactamente lo que debía")
	}
	if _, err := os.Stat(ajeno); err != nil {
		t.Fatal("la purga borró algo que no era suyo")
	}
}

// La cuota cuenta lápidas y mezcla bytes en disco con el JSON del nuevo. Se
// conserva a propósito: corregirlo mueve cuándo alguien recibe un 507.
func TestLaCuotaCuentaTambienLasLapidas(t *testing.T) {
	dir := t.TempDir()
	s := New(dir, 100*1024*1024, 3)
	sembrar(t, s, Meta{Burned: true, Ciphertext: "", BurnedAt: time.Now().UnixMilli()})
	sembrar(t, s, Meta{Owner: "sub-a"})
	sembrar(t, s, Meta{Owner: "sub-a"})
	id, _ := NewID()
	err := s.Create(Meta{ID: id, Ciphertext: "x", IV: "y", MaxViews: 1,
		ExpiresAt: time.Now().Add(time.Hour).UnixMilli()})
	if err != ErrQuota {
		t.Fatalf("con dos vivos y una lápida y tope 3 debía dar cuota, dio %v", err)
	}
}
