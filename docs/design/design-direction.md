# Design Direction — selection memo

**Selected:** Territory A, "Two Rooms" (see `design-territories.md`).

**Criterion that mattered most:** positioning. SRS §9 says the Boundary Inspector and async-RSC
support "are the product"; Two Rooms is the only territory in which that idea organises the whole
UI rather than one tab.

**For a new team member:** colour in this UI means _where code ran_ — the server colour, the client
colour, or the shared mark — and every such colour comes with a letter glyph and a text label.
Everything else is neutral ink, so if something on screen has a hue, it is telling you about the
render, not decorating the tool.

**Lost fairly:** Instrument (measurement-first) and Specimen Sheet (review-first). Budget figures
from Instrument survive as plain tabular numbers in the inspector; the reviewer needs from Specimen
Sheet are met by the canvas being the largest region and by the static build hiding editing UI.
