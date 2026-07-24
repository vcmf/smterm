// Cheap "is there a pasteable image on the clipboard?" predicate over the format list —
// avoids decoding the whole bitmap (readImage(), slow on Windows) in the common case.
// Pure — unit-tested. The main handler falls back to readImage() when this is false, so a
// DIB-only source that advertises no image/* MIME is still detected (just not for free).

/** Whether the clipboard formats advertise a raster image we can paste. Excludes
 *  image/svg+xml — that's markup, not a decodable bitmap (readImage() returns empty for
 *  it), so excluding it keeps parity with the old readImage()-based check. */
export function hasImageFormat(formats: string[]): boolean {
  return formats.some((f) => f.startsWith("image/") && f !== "image/svg+xml")
}
