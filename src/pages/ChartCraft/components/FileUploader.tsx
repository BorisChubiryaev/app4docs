import React, { useState, useRef, useCallback } from "react";

interface Props {
  onFileLoaded: (file: File) => void;
  isProcessing: boolean;
}

const FileUploader: React.FC<Props> = ({ onFileLoaded, isProcessing }) => {
  const [isDragging, setIsDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFiles = useCallback(
    (files: FileList | null) => {
      if (!files?.length) return;
      const ext = files[0].name.split(".").pop()?.toLowerCase();
      if (!["csv", "xlsx", "xls"].includes(ext || "")) {
        alert("Поддерживаются только .csv, .xlsx, .xls");
        return;
      }
      onFileLoaded(files[0]);
    },
    [onFileLoaded],
  );

  return (
    <div className="cc-panel-section">
      <div
        className={`cc-upload-zone ${isDragging ? "dragging" : ""} ${isProcessing ? "disabled" : ""}`}
        onDrop={(e) => {
          e.preventDefault();
          setIsDragging(false);
          handleFiles(e.dataTransfer.files);
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node))
            setIsDragging(false);
        }}
        onClick={() => !isProcessing && inputRef.current?.click()}
      >
        <div className="cc-upload-icon">{isProcessing ? "⏳" : "📁"}</div>
        <p className="cc-upload-title">
          {isProcessing ? "Обработка..." : "Перетащите файл сюда"}
        </p>
        <p className="cc-upload-subtitle">или нажмите для выбора</p>
        <div className="cc-upload-formats">
          <span className="cc-format-badge">CSV</span>
          <span className="cc-format-badge">XLSX</span>
          <span className="cc-format-badge">XLS</span>
        </div>
        <input
          ref={inputRef}
          type="file"
          accept=".csv,.xlsx,.xls"
          onChange={(e) => handleFiles(e.target.files)}
          disabled={isProcessing}
          className="cc-file-input-hidden"
        />
      </div>
    </div>
  );
};

export default FileUploader;
