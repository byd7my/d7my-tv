---
type: fix
area: playback
highlight: Main picture no longer freezes during audio sync
---

Choosing an audio channel and syncing it no longer freezes the main picture. The sync preview and the main video each use their own frame reader, so they cannot take each other's frames.
