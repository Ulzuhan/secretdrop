package store

import (
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"
)

// Retains the legacy Node unit coverage without keeping a second backend.
func TestIDValidation(t *testing.T) {
	for _, id := range []string{"abcdefghijkl", "ABCD_1234-xy"} {
		if !ValidID(id) {
			t.Errorf("valid id rejected: %q", id)
		}
	}
	for _, id := range []string{"", "short", "abcdefghijklm", "../../secret", "%2e%2e%2faaa", "abcd/efghijk", "abcd\\efghijk", "abcdefghijkl\n", "ábcdefghijkl"} {
		if ValidID(id) {
			t.Errorf("unsafe id accepted: %q", id)
		}
	}
	for i := 0; i < 500; i++ {
		id, err := NewID()
		if err != nil || !ValidID(id) {
			t.Fatalf("generated id invalid: %q %v", id, err)
		}
	}
}

func TestFailedCreateReleasesItsLock(t *testing.T) {
	s := nuevoAlmacen(t)
	id, err := NewID()
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(s.dir, id)
	if err := os.WriteFile(path, []byte("not a directory"), 0600); err != nil {
		t.Fatal(err)
	}
	m := Meta{ID: id, Ciphertext: "cipher", IV: "iv", MaxViews: 1, ExpiresAt: time.Now().Add(time.Hour).UnixMilli()}
	if err := s.Create(m); !errors.Is(err, ErrStorage) {
		t.Fatalf("expected storage failure: %v", err)
	}
	if err := os.Remove(path); err != nil {
		t.Fatal(err)
	}
	done := make(chan error, 1)
	go func() { done <- s.Create(m) }()
	select {
	case err := <-done:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("failed create retained the lock")
	}
	if _, err := s.Consume(id); err != nil {
		t.Fatal(err)
	}
}
