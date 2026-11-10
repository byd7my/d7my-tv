---
type: feature
area: playback
highlight: Sync audio by match clock
---

Embedded MPV (Experimental, Windows) can now sync a separate audio channel by the match clock. "Sync by match clock" in the audio panel opens a small draggable window over the picture: it shows the scoreboard clock of the main video and of the audio channel (a live cropped preview, loaded as a separate silent stream so the main video never stops or resizes), the clock read from each, the difference in seconds, the current audio delay and a suggested correction you can apply or fine-tune in steps from the window. Clocks are read offline on your device. If the audio channel's picture cannot be shown, the window says why instead of showing an old frame.
