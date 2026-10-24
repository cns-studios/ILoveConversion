package crypto

import (
	"bytes"
	"strings"
	"testing"
)

func testKey(b byte) []byte { return bytes.Repeat([]byte{b}, 32) }

func TestLegacyKeyIDResolvesToCurrentMasterKey(t *testing.T) {
	ring, err := NewKeyRing("", testKey(1), nil)
	if err != nil {
		t.Fatal(err)
	}

	got, err := ring.Master(LegacyKeyID)
	if err != nil || !bytes.Equal(got, testKey(1)) {
		t.Fatalf("Master(%q) = %x, %v; want the current master key", LegacyKeyID, got, err)
	}
	if id, _ := ring.Current(); id != LegacyKeyID {
		t.Errorf("default current id = %q, want %q", id, LegacyKeyID)
	}
}

func TestDecryptUnderOldKeyAfterRotation(t *testing.T) {
	const jobID = "6f1c2d3e-0000-4000-8000-000000000001"
	plaintext := []byte("a job encrypted before the rotation")

	before, _ := NewKeyRing("1", testKey(1), nil)
	oldKey, err := before.JobKey("1", jobID)
	if err != nil {
		t.Fatal(err)
	}
	var enc bytes.Buffer
	if err := EncryptStream(oldKey, bytes.NewReader(plaintext), &enc); err != nil {
		t.Fatal(err)
	}

	// Rotation: key 2 is current, the former master key is kept under its old id.
	after, err := NewKeyRing("2", testKey(2), map[string][]byte{"1": testKey(1)})
	if err != nil {
		t.Fatal(err)
	}

	key, err := after.JobKey("1", jobID)
	if err != nil {
		t.Fatal(err)
	}
	var dec bytes.Buffer
	if err := DecryptStream(key, bytes.NewReader(enc.Bytes()), &dec); err != nil || !bytes.Equal(dec.Bytes(), plaintext) {
		t.Fatalf("decrypt under old key_id: %v, got %q", err, dec.Bytes())
	}

	// The current key must not decrypt the old job.
	newKey, _ := after.JobKey("2", jobID)
	if err := DecryptStream(newKey, bytes.NewReader(enc.Bytes()), &bytes.Buffer{}); err == nil {
		t.Error("current key decrypted a job encrypted under the old key")
	}

	if id := after.CurrentID(); id != "2" {
		t.Errorf("CurrentID = %q, want 2", id)
	}
}

func TestKeyRingRejectsBadInput(t *testing.T) {
	if _, err := NewKeyRing("1", []byte("short"), nil); err == nil {
		t.Error("short current key accepted")
	}
	if _, err := NewKeyRing("1", testKey(1), map[string][]byte{"1": testKey(2)}); err == nil {
		t.Error("old key colliding with current id accepted")
	}
	ring, _ := NewKeyRing("1", testKey(1), nil)
	if _, err := ring.Master("nope"); err == nil || !strings.Contains(err.Error(), "unknown") {
		t.Errorf("unknown id = %v, want an unknown-key error", err)
	}
}

func TestParseOldKeys(t *testing.T) {
	hexKey := strings.Repeat("ab", 32)
	got, err := ParseOldKeys(" 1:" + hexKey + " , 3:" + hexKey + ",")
	if err != nil || len(got) != 2 || len(got["1"]) != 32 {
		t.Fatalf("ParseOldKeys = %v, %v", got, err)
	}
	for _, bad := range []string{"nocolon", ":" + hexKey, "1:zz"} {
		if _, err := ParseOldKeys(bad); err == nil {
			t.Errorf("ParseOldKeys(%q) accepted", bad)
		}
	}
}
