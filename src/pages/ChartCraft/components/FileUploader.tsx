import React, { useState, useRef } from "react";
import { Icon } from "./icons";

interface Props {
  onFile: (file: File) => void;
  onPaste: (text: string) => void;
  onDemo: () => void;
  isProcessing: boolean;
}

const ACCEPT = [".csv", ".tsv", ".txt", ".xlsx", ".xlsm"];

const FileUploader: React.FC<Props> = ({ onFile, onPaste, onDemo, isProcessing }) => {
  const [isDragging, setIsDragging] = useState(false);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [text, setText] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFiles = (files: FileList | null) => {
    if (files?.length) onFile(files[0]); // формат проверит разборщик — с понятной ошибкой
  };

  return (
    <div className="cc-panel-section">
      <div
        className={`cc-upload-zone ${isDragging ? "dragging" : ""} ${isProcessing ? "disabled" : ""}`}
        role="button"
        tabIndex={0}
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
          if (!e.currentTarget.contains(e.relatedTarget as Node)) setIsDragging(false);
        }}
        onClick={() => !isProcessing && inputRef.current?.click()}
        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && inputRef.current?.click()}
      >
        <div className="cc-upload-icon">{isProcessing ? <span className="cc-spinner-mini" /> : <Icon name="folder" size={44} />}</div>
        <p className="cc-upload-title">{isProcessing ? "Читаем файл…" : "Перетащите таблицу сюда"}</p>
        <p className="cc-upload-subtitle">или нажмите, чтобы выбрать файл</p>
        <div className="cc-upload-formats">
          <span className="cc-format-badge">XLSX</span>
          <span className="cc-format-badge">CSV</span>
        </div>
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT.join(",")}
          onChange={(e) => {
            handleFiles(e.target.files);
            e.target.value = ""; // чтобы тот же файл можно было выбрать снова
          }}
          disabled={isProcessing}
          className="cc-file-input-hidden"
        />
      </div>

      <div className="cc-upload-alt">
        <button
          type="button"
          className="cc-button cc-button-secondary"
          onClick={() => setPasteOpen((v) => !v)}
          aria-expanded={pasteOpen}
          disabled={isProcessing}
        >
          <Icon name="clipboard" size={16} />
          Вставить из Excel
        </button>
        <button type="button" className="cc-button cc-button-secondary" onClick={onDemo} disabled={isProcessing}>
          <Icon name="chart" size={16} />
          Попробовать на примере
        </button>
      </div>

      {pasteOpen && (
        <div className="cc-paste-box">
          <label className="cc-field-label" htmlFor="cc-paste">
            Скопируйте диапазон в Excel (вместе с заголовками) и вставьте сюда
          </label>
          <textarea
            id="cc-paste"
            className="cc-input cc-paste-area"
            rows={8}
            value={text}
            autoFocus
            placeholder={"Месяц\tВыручка\nЯнварь\t120 000\nФевраль\t135 500"}
            onChange={(e) => setText(e.target.value)}
          />
          <div className="cc-paste-actions">
            <button
              type="button"
              className="cc-button cc-button-primary"
              disabled={!text.trim() || isProcessing}
              onClick={() => onPaste(text)}
            >
              Построить
            </button>
          </div>
        </div>
      )}
      <p className="cc-upload-note">
        Старый формат .xls пересохраните в .xlsx. Данные никуда не отправляются — всё
        считается в браузере.
      </p>
    </div>
  );
};

export default FileUploader;
