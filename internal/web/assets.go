// Package web lleva dentro del binario lo que construye vite. Un solo fichero
// que desplegar, sin volumen de estáticos ni servidor delante repartiendo.
package web

import (
	"embed"
	"encoding/json"
	"io/fs"
	"net/http"
	"strings"
)

//go:embed all:dist
var incrustado embed.FS

// Recursos son los nombres con hash que vite ha generado en esta construcción.
// Van en el HTML, y por eso se leen del manifiesto en vez de escribirse a mano:
// un nombre desfasado da una página en blanco sin decir por qué.
type Recursos struct {
	JS  string
	CSS []string
}

type entrada struct {
	File    string   `json:"file"`
	CSS     []string `json:"css"`
	IsEntry bool     `json:"isEntry"`
}

// Cargar lee el manifiesto. Devuelve recursos vacíos si no hay construcción:
// el binario sigue sirviendo la API, que es lo que permite probarlo sin haber
// pasado por vite.
func Cargar() (Recursos, error) {
	crudo, err := incrustado.ReadFile("dist/.vite/manifest.json")
	if err != nil {
		return Recursos{}, nil
	}
	var manifiesto map[string]entrada
	if err := json.Unmarshal(crudo, &manifiesto); err != nil {
		return Recursos{}, err
	}
	for _, e := range manifiesto {
		if e.IsEntry {
			return Recursos{JS: "/" + e.File, CSS: conBarra(e.CSS)}, nil
		}
	}
	return Recursos{}, nil
}

func conBarra(rutas []string) []string {
	salida := make([]string, 0, len(rutas))
	for _, r := range rutas {
		salida = append(salida, "/"+r)
	}
	return salida
}

// Handler sirve lo construido. Los nombres llevan hash del contenido, así que
// se pueden cachear para siempre: si cambia el contenido, cambia el nombre.
func Handler() (http.Handler, error) {
	sub, err := fs.Sub(incrustado, "dist")
	if err != nil {
		return nil, err
	}
	ficheros := http.FileServer(http.FS(sub))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// El manifiesto es de la construcción, no del sitio: no se sirve.
		if strings.HasPrefix(r.URL.Path, "/.vite/") {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
		ficheros.ServeHTTP(w, r)
	}), nil
}
