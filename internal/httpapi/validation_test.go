package httpapi

import (
	"math"
	"testing"
)

func TestRangeClamp(t *testing.T) {
	for _, tc := range []struct {
		name  string
		value any
		want  int64
	}{
		{"number", float64(3), 3}, {"floor", 3.9, 3}, {"minimum", float64(-1), 1}, {"maximum", float64(100), 10},
		{"missing", nil, 5}, {"string", "3", 5}, {"boolean", true, 5}, {"object", map[string]any{}, 5},
		{"array", []any{3}, 5}, {"nan", math.NaN(), 5}, {"infinity", math.Inf(1), 5}, {"negative infinity", math.Inf(-1), 5},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if got := enRango(tc.value, 1, 10, 5); got != tc.want {
				t.Fatalf("got %d, want %d", got, tc.want)
			}
		})
	}
}
