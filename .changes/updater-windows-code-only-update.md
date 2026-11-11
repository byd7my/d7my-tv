---
type: feature
area: updater
---

On Windows, updates now replace only the app's code (about 45 MB) instead of running a new installer. Windows Smart App Control can refuse a new installer on a PC where the last one ran; the code file is plain data, so it is never refused. Installs that predate this need one manual swap of resources\app.asar (the zip is attached to the release).
