package main

import (
	"testing"

	"golang.org/x/mod/semver"
)

// migList phải tăng dần theo semver, kể cả bản của fork (vX.Y.Z-omni.N), vì getPendingMigrations
// chạy mọi bản đứng sau bản cuối đã ghi.
func TestMigListSorted(t *testing.T) {
	for i, m := range migList {
		if !semver.IsValid(m.version) {
			t.Fatalf("invalid version %q", m.version)
		}
		if i > 0 && semver.Compare(migList[i-1].version, m.version) >= 0 {
			t.Fatalf("%s must sort after %s", m.version, migList[i-1].version)
		}
	}
	if semver.Compare("v2.8.1-omni.1", "v2.8.0") <= 0 || semver.Compare("v2.8.1-omni.1", "v2.8.1") >= 0 {
		t.Fatal("fork migration must sit between v2.8.0 and v2.8.1")
	}
}
