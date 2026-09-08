package auth

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func TestConfigOidcFromEnv(t *testing.T) {
	t.Setenv("SECRETDROP_OIDC_ISSUER", "https://idp.example/realms/secretdrop")
	t.Setenv("SECRETDROP_OIDC_CLIENT_ID", "qr")
	t.Setenv("SECRETDROP_OIDC_CLIENT_SECRET", "synthetic")
	t.Setenv("SECRETDROP_OIDC_REDIRECT_URI", "https://secretdrop.example/api/auth/callback")
	t.Setenv("SECRETDROP_OIDC_INTERNAL_BASE", "")
	if c := OidcFromEnv(); c == nil || c.PublicOrigin != "https://idp.example" || c.InternalOrigin != c.PublicOrigin {
		t.Fatal("unexpected default config")
	}
	t.Setenv("SECRETDROP_OIDC_INTERNAL_BASE", "http://idp-internal:9000")
	if c := OidcFromEnv(); c == nil || c.InternalOrigin != "http://idp-internal:9000" {
		t.Fatal("internal origin lost")
	}
	for _, key := range []string{"SECRETDROP_OIDC_ISSUER", "SECRETDROP_OIDC_CLIENT_ID", "SECRETDROP_OIDC_CLIENT_SECRET", "SECRETDROP_OIDC_REDIRECT_URI"} {
		t.Run(key, func(t *testing.T) {
			t.Setenv(key, "")
			if OidcFromEnv() != nil {
				t.Fatal("incomplete configuration accepted")
			}
		})
	}
}

func TestDiscoveryProviderPathsAndCache(t *testing.T) {
	var requests, status atomic.Int64
	var incomplete atomic.Bool
	status.Store(http.StatusOK)
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests.Add(1)
		if r.URL.Path != "/realms/secretdrop/.well-known/openid-configuration" {
			t.Errorf("discovery path: %s", r.URL.Path)
		}
		w.WriteHeader(int(status.Load()))
		internal := "http://" + r.Host
		doc := map[string]string{"issuer": internal + "/realms/secretdrop"}
		if !incomplete.Load() {
			for key, path := range map[string]string{"authorization_endpoint": "auth", "token_endpoint": "token", "userinfo_endpoint": "userinfo", "end_session_endpoint": "logout", "jwks_uri": "certs"} {
				doc[key] = internal + "/realms/secretdrop/protocol/openid-connect/" + path
			}
		}
		_ = json.NewEncoder(w).Encode(doc)
	}))
	defer provider.Close()
	internal := provider.URL
	cfg := &OidcConfig{Issuer: "https://idp.example/realms/secretdrop", PublicOrigin: "https://idp.example", InternalOrigin: internal, ClientID: "qr", RedirectURI: "https://secretdrop.example/api/auth/callback"}
	d := NewDiscovery()
	ctx := context.Background()
	e, err := d.Discover(ctx, cfg)
	if err != nil {
		t.Fatal(err)
	}
	if e.Authorization != "https://idp.example/realms/secretdrop/protocol/openid-connect/auth" || e.EndSession != "https://idp.example/realms/secretdrop/protocol/openid-connect/logout" {
		t.Fatalf("public endpoints: %+v", e)
	}
	for _, endpoint := range []string{e.Token, e.UserInfo, e.JWKS} {
		if !strings.HasPrefix(endpoint, internal+"/realms/secretdrop/protocol/openid-connect/") {
			t.Errorf("internal endpoint: %s", endpoint)
		}
	}
	for _, issuer := range []string{cfg.Issuer, internal + "/realms/secretdrop"} {
		found := false
		for _, value := range e.Issuers {
			found = found || issuer == value
		}
		if !found {
			t.Errorf("missing issuer %s", issuer)
		}
	}
	raw, err := d.AuthorizeURL(ctx, cfg, "state", "challenge")
	if err != nil {
		t.Fatal(err)
	}
	u, _ := url.Parse(raw)
	if u.Port() != "" || u.Query().Get("code_challenge_method") != "S256" || u.Query().Get("state") != "state" {
		t.Fatalf("authorization: %s", raw)
	}
	if requests.Load() != 1 {
		t.Fatalf("cache missed: %d requests", requests.Load())
	}
	d.mu.Lock()
	d.cuando = time.Now().Add(-d.ttl - time.Second)
	d.mu.Unlock()
	status.Store(http.StatusInternalServerError)
	if got, err := d.Discover(ctx, cfg); err != nil || got != e || requests.Load() != 2 {
		t.Fatalf("stale fallback: %v, requests=%d", err, requests.Load())
	}
	if _, err := NewDiscovery().Discover(ctx, cfg); err == nil {
		t.Fatal("cold discovery accepted HTTP 500")
	}
	status.Store(http.StatusOK)
	incomplete.Store(true)
	if _, err := NewDiscovery().Discover(ctx, cfg); err == nil {
		t.Fatal("incomplete discovery accepted")
	}
}
