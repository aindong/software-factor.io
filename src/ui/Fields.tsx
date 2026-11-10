// A field for a whole number of 1 or more. The text is the person's while they type: it is
// taken into the workflow only when it is such a number, and it says so when it is not. (A
// field that corrects every key makes "90" out of an emptied "60" into "190".)
import { useEffect, useState } from "react";

export function WholeNumber(props: {
  label: string;
  value: number | undefined;
  onCommit: (value: number) => void;
}) {
  const [text, setText] = useState(props.value === undefined ? "" : String(props.value));
  const whole = (t: string) => /^[1-9]\d*$/.test(t) && Number.isSafeInteger(Number(t)); // a larger one is not kept as typed
  const good = whole(text);
  // a value that changes elsewhere (undo, the JSON view) is shown, unless it is what was just typed
  useEffect(() => {
    setText((now) =>
      Number(now) === props.value ? now : props.value === undefined ? "" : String(props.value),
    );
  }, [props.value]);
  return (
    <label className="field">
      <span className="label">{props.label}</span>
      <input
        inputMode="numeric"
        value={text}
        aria-invalid={!good}
        onChange={(event) => {
          setText(event.target.value);
          if (whole(event.target.value)) props.onCommit(Number(event.target.value));
        }}
        // left as it is not a number: back to the number the workflow holds
        onBlur={() => good || setText(props.value === undefined ? "" : String(props.value))}
      />
      {good ? null : (
        <span className="hint bad">
          A whole number, 1 or more. The workflow keeps {props.value ?? "none"}.
        </span>
      )}
    </label>
  );
}
