/** Characters that are invisible or change the direction of the text around them. */
export function isUnprintable(codePoint: number): boolean {
  return (
    codePoint < 0x20 ||
    codePoint === 0x7f ||
    (codePoint >= 0x200b && codePoint <= 0x200f) ||
    (codePoint >= 0x202a && codePoint <= 0x202e) ||
    (codePoint >= 0x2066 && codePoint <= 0x2069)
  );
}

/** True when every character of the text can be shown as it is. */
export const isPrintable = (text: string): boolean => [...text].every((character) => !isUnprintable(character.codePointAt(0)!));
