import React, { useState } from "react";
import type { ChartTemplate } from "../types";

interface Props {
  templates: ChartTemplate[];
  onSave: (name: string) => void;
  onLoad: (template: ChartTemplate) => void;
  onDelete: (id: string) => void;
}

const TemplateManager: React.FC<Props> = ({
  templates,
  onSave,
  onLoad,
  onDelete,
}) => {
  const [templateName, setTemplateName] = useState("");
  const [showTemplates, setShowTemplates] = useState(false);

  const handleSave = () => {
    if (!templateName.trim()) return;
    onSave(templateName.trim());
    setTemplateName("");
  };

  return (
    <div className="cc-template-manager">
      <h4 className="cc-customizer-group-title">📋 Шаблоны</h4>

      {/* Save */}
      <div className="cc-template-save">
        <input
          type="text"
          value={templateName}
          onChange={(e) => setTemplateName(e.target.value)}
          placeholder="Название шаблона"
          className="cc-input"
          onKeyDown={(e) => e.key === "Enter" && handleSave()}
        />
        <button
          className="cc-button cc-button-primary"
          onClick={handleSave}
          disabled={!templateName.trim()}
        >
          💾 Сохранить
        </button>
      </div>

      {/* Load */}
      {templates.length > 0 && (
        <>
          <button
            className="cc-template-toggle"
            onClick={() => setShowTemplates(!showTemplates)}
          >
            {showTemplates ? "▼" : "▶"} Сохранённые шаблоны (
            {templates.length})
          </button>

          {showTemplates && (
            <div className="cc-template-list">
              {templates.map((t) => (
                <div key={t.id} className="cc-template-item">
                  <div className="cc-template-info">
                    <span className="cc-template-name">{t.name}</span>
                    <span className="cc-template-date">
                      {new Date(t.createdAt).toLocaleDateString("ru-RU")}
                    </span>
                  </div>
                  <div className="cc-template-actions">
                    <button
                      className="cc-button-icon"
                      onClick={() => onLoad(t)}
                      title="Применить"
                    >
                      📥
                    </button>
                    <button
                      className="cc-button-icon cc-button-danger"
                      onClick={() => onDelete(t.id)}
                      title="Удалить"
                    >
                      🗑️
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default TemplateManager;
