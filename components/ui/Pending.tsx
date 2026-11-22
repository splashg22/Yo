/**
 * A figure that has been asked for and has not arrived: three small dots where it will be, the width of a short
 * number, so nothing moves when it does. Said aloud as "being read". A screen shows these in place of its figures;
 * it does not write the word "Reading" in every cell.
 */
export function Pending() {
  return (
    <span className="pending" data-pending role="img" aria-label="Being read">
      <i />
      <i />
      <i />
    </span>
  );
}
