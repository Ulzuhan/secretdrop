// Package store guarda los secretos en el MISMO formato que la implementación
// Node: un directorio por id con su `meta.json`. Nada de base de datos, nada de
// renombrar campos. Lo que este paquete no puede permitirse es entregar un
// criptograma más veces de las que se pidió, ni entregarlo sin haber dejado
// constancia de la vista.
package store

import (
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"sync"
	"time"
)

// Meta es el registro tal y como está en disco. `omitempty` en los dos últimos
// porque Node los omite: un registro heredado no tiene `owner`, y uno vivo no
// tiene `burnedAt`.
type Meta struct {
	ID         string `json:"id"`
	Ciphertext string `json:"ciphertext"`
	IV         string `json:"iv"`
	ExpiresAt  int64  `json:"expiresAt"`
	MaxViews   int    `json:"maxViews"`
	ViewCount  int    `json:"viewCount"`
	CreatedAt  int64  `json:"createdAt"`
	Burned     bool   `json:"burned"`
	BurnedAt   int64  `json:"burnedAt,omitempty"`
	Owner      string `json:"owner,omitempty"`
}

// TombstoneTTL: una lápida se conserva siete días para poder responder «ya se
// usó» en vez de «no existe».
const TombstoneTTL = 7 * 24 * time.Hour

var idValido = regexp.MustCompile(`^[A-Za-z0-9_-]{12}$`)

// ValidID replica `idValido` de Node. No es cosmética: el id llega de la URL y
// se concatena con la ruta del almacén.
func ValidID(id string) bool { return idValido.MatchString(id) }

// Razones de un consumo fallido, con los mismos nombres que en Node para que la
// tabla de estados HTTP se lea igual en los dos sitios.
var (
	ErrNotFound = errors.New("not_found")
	ErrExpired  = errors.New("expired")
	ErrBurned   = errors.New("burned")
	ErrStorage  = errors.New("storage_error")
	ErrQuota    = errors.New("quota")
)

type Store struct {
	dir       string
	maxBytes  int64
	maxActive int
	mu        sync.RWMutex
	index     map[string]Meta
	locks     sync.Map // id -> *sync.Mutex
	createMu  sync.Mutex
	now       func() time.Time
}

func New(dir string, maxBytes int64, maxActive int) *Store {
	return &Store{dir: dir, maxBytes: maxBytes, maxActive: maxActive,
		index: map[string]Meta{}, now: time.Now}
}

func (s *Store) lockFor(id string) *sync.Mutex {
	actual, _ := s.locks.LoadOrStore(id, &sync.Mutex{})
	return actual.(*sync.Mutex)
}

func (s *Store) path(id string) string { return filepath.Join(s.dir, id, "meta.json") }

// Hydrate llena el índice desde disco y purga lo caducado y las lápidas viejas.
//
// En Node esto se lanzaba al cargar el módulo y SIN esperarlo, y el primer
// listado podía salir corto: con 2000 registros devolvía 1606. Aquí se llama
// antes de escuchar, que es la forma de que esa carrera no exista.
func (s *Store) Hydrate() error {
	entradas, err := os.ReadDir(s.dir)
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return err
	}
	ahora := s.now()
	for _, e := range entradas {
		id := e.Name()
		// Lo que no tenga forma de id nuestro se ignora, no se borra: este
		// barrido no decide sobre ficheros ajenos.
		if !ValidID(id) {
			continue
		}
		meta, err := s.leerDisco(id)
		if err != nil {
			continue
		}
		lapidaVieja := meta.Burned &&
			(meta.BurnedAt == 0 || ahora.Sub(time.UnixMilli(meta.BurnedAt)) > TombstoneTTL)
		if lapidaVieja || (!meta.Burned && meta.ExpiresAt < ahora.UnixMilli()) {
			_ = s.borrar(id)
			continue
		}
		s.mu.Lock()
		s.index[id] = meta
		s.mu.Unlock()
	}
	return nil
}

func (s *Store) leerDisco(id string) (Meta, error) {
	var meta Meta
	raw, err := os.ReadFile(s.path(id))
	if err != nil {
		return meta, err
	}
	if err := json.Unmarshal(raw, &meta); err != nil {
		return meta, err
	}
	return meta, nil
}

// load busca en el índice y, si no está, lee disco y lo siembra. La segunda
// mirada al índice no sobra: entre una cosa y otra caben otras peticiones del
// mismo id, y cada una se quedaría con su propia copia y su propia cuenta de
// vistas. Aquí el candado por id ya lo impide, pero el índice se comparte.
func (s *Store) load(id string) (Meta, bool) {
	s.mu.RLock()
	meta, ok := s.index[id]
	s.mu.RUnlock()
	if ok {
		return meta, true
	}
	meta, err := s.leerDisco(id)
	if err != nil {
		return Meta{}, false
	}
	s.mu.Lock()
	if ya, ok := s.index[id]; ok {
		s.mu.Unlock()
		return ya, true
	}
	s.index[id] = meta
	s.mu.Unlock()
	return meta, true
}

// escribir deja el fichero en su sitio de una pieza: temporal en el MISMO
// directorio, sincronizado, y `rename` encima. Un lector nunca ve medio JSON.
func (s *Store) escribir(meta Meta) error {
	dir := filepath.Join(s.dir, meta.ID)
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return err
	}
	datos, err := json.Marshal(meta)
	if err != nil {
		return err
	}
	tmp, err := os.CreateTemp(dir, ".meta-*.json")
	if err != nil {
		return err
	}
	nombre := tmp.Name()
	defer os.Remove(nombre)
	if _, err := tmp.Write(datos); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Sync(); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	if err := os.Rename(nombre, s.path(meta.ID)); err != nil {
		return err
	}
	s.mu.Lock()
	s.index[meta.ID] = meta
	s.mu.Unlock()
	return nil
}

func (s *Store) borrar(id string) error {
	s.mu.Lock()
	delete(s.index, id)
	s.mu.Unlock()
	if err := os.Remove(s.path(id)); err != nil && !os.IsNotExist(err) {
		return err
	}
	_ = os.Remove(filepath.Join(s.dir, id))
	return nil
}

// Consume reclama exactamente una vista. La cuenta se persiste ANTES de
// devolver el criptograma: si se cae entre una cosa y otra se consume sin
// entregar, que es el lado por el que hay que equivocarse.
func (s *Store) Consume(id string) (Meta, error) {
	if !ValidID(id) {
		return Meta{}, ErrNotFound
	}
	lock := s.lockFor(id)
	lock.Lock()
	defer lock.Unlock()

	meta, ok := s.load(id)
	if !ok {
		return Meta{}, ErrNotFound
	}
	ahora := s.now().UnixMilli()
	if meta.ExpiresAt < ahora {
		_ = s.borrar(id)
		return Meta{}, ErrExpired
	}
	if meta.Burned || meta.ViewCount >= meta.MaxViews {
		return Meta{}, ErrBurned
	}

	meta.ViewCount++
	meta.Burned = meta.ViewCount >= meta.MaxViews
	entregado := meta

	guardar := meta
	if meta.Burned {
		// La lápida va sin criptograma: lo que queda es la constancia de que
		// se usó, no el secreto.
		guardar.Ciphertext = ""
		guardar.IV = ""
		guardar.BurnedAt = s.now().UnixMilli()
	}
	if err := s.escribir(guardar); err != nil {
		return Meta{}, ErrStorage
	}
	return entregado, nil
}

// Create aplica la cuota antes de escribir. El recuento recorre TODOS los
// `meta.json`, lápidas incluidas, y suma bytes en disco contra el JSON del
// registro nuevo: es lo que hace Node, y cambiarlo mueve cuándo alguien recibe
// un 507. Se conserva a propósito.
func (s *Store) Create(meta Meta) error {
	s.createMu.Lock()
	defer s.createMu.Unlock()

	entradas, err := os.ReadDir(s.dir)
	if err != nil && !os.IsNotExist(err) {
		return ErrStorage
	}
	var bytes int64
	var count int
	for _, e := range entradas {
		if !ValidID(e.Name()) {
			continue
		}
		info, err := os.Stat(s.path(e.Name()))
		if err != nil {
			continue
		}
		bytes += info.Size()
		count++
	}
	nuevo, err := json.Marshal(meta)
	if err != nil {
		return ErrStorage
	}
	if count >= s.maxActive || bytes+int64(len(nuevo)) > s.maxBytes {
		return ErrQuota
	}
	if err := s.escribir(meta); err != nil {
		return ErrStorage
	}
	return nil
}

// List devuelve los vivos de ese titular, del más nuevo al más viejo y sin
// criptograma. Lo de otras cuentas y lo que no tiene dueño no sale.
func (s *Store) List(owner string) []Meta {
	ahora := s.now().UnixMilli()
	s.mu.RLock()
	defer s.mu.RUnlock()
	var vivos []Meta
	for _, meta := range s.index {
		if meta.ExpiresAt > ahora && !meta.Burned && meta.Owner != "" && meta.Owner == owner {
			meta.Ciphertext = ""
			meta.IV = ""
			vivos = append(vivos, meta)
		}
	}
	sort.Slice(vivos, func(i, j int) bool { return vivos[i].CreatedAt > vivos[j].CreatedAt })
	return vivos
}

// CleanupExpired es el barrido explícito de `/api/cleanup`.
func (s *Store) CleanupExpired() int {
	entradas, err := os.ReadDir(s.dir)
	if err != nil {
		return 0
	}
	ahora := s.now()
	borrados := 0
	for _, e := range entradas {
		id := e.Name()
		if !ValidID(id) {
			continue
		}
		lock := s.lockFor(id)
		lock.Lock()
		meta, ok := s.load(id)
		if ok {
			lapidaVieja := meta.Burned &&
				(meta.BurnedAt == 0 || ahora.Sub(time.UnixMilli(meta.BurnedAt)) > TombstoneTTL)
			if lapidaVieja || (!meta.Burned && meta.ExpiresAt < ahora.UnixMilli()) {
				if s.borrar(id) == nil {
					borrados++
				}
			}
		}
		lock.Unlock()
	}
	return borrados
}

// NewID: nueve bytes aleatorios en base64url, que dan los doce caracteres que
// espera `ValidID` y que ya llevan los enlaces emitidos.
func NewID() (string, error) {
	crudo := make([]byte, 9)
	if _, err := rand.Read(crudo); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(crudo), nil
}
