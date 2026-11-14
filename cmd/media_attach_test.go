package main

import "testing"

func TestMediaAttachableBy(t *testing.T) {
	cases := []struct {
		meta string
		want bool
	}{
		{`{"uploader_id":7,"width":10}`, true},
		{`{"uploader_id":8}`, false},
		{`{"width":10}`, true},
		{`{}`, true},
		{``, true},
	}
	for _, c := range cases {
		if got := mediaAttachableBy([]byte(c.meta), 7); got != c.want {
			t.Errorf("meta %s: got %v", c.meta, got)
		}
	}
}
