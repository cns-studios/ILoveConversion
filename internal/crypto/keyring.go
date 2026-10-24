package crypto

import (
	"encoding/hex"
	"fmt"
	"strings"
)

// LegacyKeyID is the key_id of every job created before key rotation existed. It names whatever
// ENCRYPTION_MASTER_KEY is, unless a rotation moved the current key to another id.
const LegacyKeyID = "1"

// KeyRing maps key ids, as stored in jobs.key_id, to master keys. New jobs are encrypted under
// the current key; jobs created under an older key keep decrypting through their stored id.
type KeyRing struct {
	currentID string
	keys      map[string][]byte
}

func NewKeyRing(currentID string, current []byte, old map[string][]byte) (*KeyRing, error) {
	if currentID == "" {
		currentID = LegacyKeyID
	}
	if len(current) != 32 {
		return nil, fmt.Errorf("master key must be 32 bytes, got %d", len(current))
	}

	keys := map[string][]byte{currentID: current}
	for id, k := range old {
		if len(k) != 32 {
			return nil, fmt.Errorf("old key %q must be 32 bytes, got %d", id, len(k))
		}
		if id == currentID {
			return nil, fmt.Errorf("old key id %q collides with the current key id", id)
		}
		keys[id] = k
	}
	return &KeyRing{currentID: currentID, keys: keys}, nil
}

// ParseOldKeys parses "id:hex,id:hex" as used by ENCRYPTION_OLD_KEYS.
func ParseOldKeys(s string) (map[string][]byte, error) {
	out := map[string][]byte{}
	for _, part := range strings.Split(s, ",") {
		part = strings.TrimSpace(part)
		if part == "" {
			continue
		}
		id, hexKey, ok := strings.Cut(part, ":")
		if !ok || id == "" {
			return nil, fmt.Errorf("ENCRYPTION_OLD_KEYS entries must look like id:hex")
		}
		key, err := hex.DecodeString(hexKey)
		if err != nil {
			return nil, fmt.Errorf("ENCRYPTION_OLD_KEYS key %q is not valid hex", id)
		}
		out[id] = key
	}
	return out, nil
}

// Current returns the id and key that new jobs are encrypted under.
func (r *KeyRing) Current() (string, []byte) {
	return r.currentID, r.keys[r.currentID]
}

// CurrentID is the key_id to store on new jobs.
func (r *KeyRing) CurrentID() string { return r.currentID }

// Master returns the master key for a stored key_id.
func (r *KeyRing) Master(keyID string) ([]byte, error) {
	if k, ok := r.keys[keyID]; ok {
		return k, nil
	}
	return nil, fmt.Errorf("unknown encryption key id %q", keyID)
}

// JobKey derives the per-job file key under the master key a job was created with.
func (r *KeyRing) JobKey(keyID, jobID string) ([]byte, error) {
	master, err := r.Master(keyID)
	if err != nil {
		return nil, err
	}
	return DeriveKey(master, jobID)
}
