import { useCallback, useRef, useState, type DragEvent } from "react";

interface FileUploadProps {
  onFiles: (files: File[]) => void;
  disabled?: boolean;
}

export default function FileUpload({ onFiles, disabled = false }: FileUploadProps) {
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleDrop = useCallback(
    (e: DragEvent) => {
      e.preventDefault();
      setDragging(false);
      if (disabled) return;
      const files = Array.from(e.dataTransfer.files).filter((file) =>
        file.name.toLowerCase().endsWith(".csv"),
      );
      if (files.length > 0) onFiles(files);
    },
    [onFiles, disabled],
  );

  const handleFileInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (disabled) return;
      const files = Array.from(e.target.files ?? []).filter((file) =>
        file.name.toLowerCase().endsWith(".csv"),
      );
      if (files.length > 0) onFiles(files);
      // Reset so the same file can be re-selected
      if (inputRef.current) inputRef.current.value = "";
    },
    [onFiles, disabled],
  );

  return (
    <div
      className={`file-upload ${dragging ? "dragging" : ""} ${disabled ? "disabled" : ""}`}
      onDragOver={(e) => {
        e.preventDefault();
        if (!disabled) setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
    >
      <p>Drop CSV file(s) here</p>
      <label className="file-upload-btn">
        Browse
        <input
          ref={inputRef}
          type="file"
          accept=".csv"
          multiple
          onChange={handleFileInput}
          hidden
          disabled={disabled}
        />
      </label>
    </div>
  );
}
