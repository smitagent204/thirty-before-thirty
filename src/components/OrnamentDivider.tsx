interface OrnamentDividerProps {
  label?: string;
}

export function OrnamentDivider({ label }: OrnamentDividerProps) {
  if (label) {
    return (
      <div className="ornament ornament--chapter">
        <span className="ornament__line" />
        <span className="ornament__label">{label}</span>
        <span className="ornament__line" />
      </div>
    );
  }

  return (
    <div className="ornament" aria-hidden="true">
      <span className="ornament__line" />
      <span className="ornament__diamond" />
      <span className="ornament__line" />
    </div>
  );
}
