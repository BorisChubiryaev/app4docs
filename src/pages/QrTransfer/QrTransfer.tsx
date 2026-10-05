import React, { useState } from "react";
import PageShell from "../../components/PageShell";
import InstructionsModal from "../../components/InstructionsModal";
import Sender from "./Sender";
import Receiver from "./Receiver";
import "./QrTransfer.css";

type Mode = "send" | "receive";

const QrTransfer: React.FC = () => {
  const [mode, setMode] = useState<Mode>("send");
  const [help, setHelp] = useState(false);

  return (
    <PageShell
      title="Передача файлов через QR"
      subtitle="Без сети, AirDrop и Bluetooth: экран одного ноутбука → камера другого"
      icon="📡"
      width={1200}
      onShowInstructions={() => setHelp(true)}
    >
      <div className="qrt-mode">
        <div className="ds-tabs">
          <button
            className={`ds-tab${mode === "send" ? " ds-tab--active" : ""}`}
            onClick={() => setMode("send")}
          >
            📤 Отправить
          </button>
          <button
            className={`ds-tab${mode === "receive" ? " ds-tab--active" : ""}`}
            onClick={() => setMode("receive")}
          >
            📥 Получить
          </button>
        </div>
      </div>

      {mode === "send" ? <Sender /> : <Receiver />}

      <InstructionsModal
        isOpen={help}
        onClose={() => setHelp(false)}
        title="📚 Передача файлов через QR"
        maxWidth={760}
      >
        <div className="instructions-section">
          <h3>🎯 Как это работает</h3>
          <p>
            Отправитель показывает на экране поток QR-кодов, получатель читает
            их камерой. Используется <strong>фонтанный код</strong>: каждый
            QR несёт новую «смесь» данных, поэтому пропущенные кадры не нужно
            ловить повторно — достаточно принять любые ≈ 105% от объёма
            файла. Начинать приём можно в любой момент показа.
          </p>
          <p>Всё работает офлайн, данные никуда не отправляются.</p>
        </div>
        <div className="instructions-section">
          <h3>🛠 Порядок действий</h3>
          <ul>
            <li>
              <strong>Ноутбук-отправитель:</strong> вкладка «Отправить» →
              выберите файл → «Начать показ». Яркость экрана — на максимум.
            </li>
            <li>
              <strong>Ноутбук-получатель:</strong> вкладка «Получить» →
              «Включить камеру» и направьте её на экран отправителя так, чтобы
              коды целиком помещались в кадр и занимали его побольше
              (обычно 30–50 см).
            </li>
            <li>
              Когда прогресс дойдёт до 100%, нажмите «Сохранить файл».
              Целостность проверяется по контрольной сумме CRC32.
            </li>
          </ul>
        </div>
        <div className="instructions-section">
          <h3>⚡ Скорость</h3>
          <ul>
            <li>
              Смотрите на «код/с» у получателя: если он заметно ниже, чем
              кадров/с × кодов у отправителя — уменьшите плотность или
              скорость смены.
            </li>
            <li>
              Ориентир для 30 МБ: «Стандарт», два кода, 8 к/с — около
              30–40 минут; «Быстро» на хорошей камере — 20–25 минут.
            </li>
            <li>
              Уберите блики (наклон экрана, свет сзади), не трогайте
              ноутбуки во время передачи. Пауза — пробел, выход — Esc.
            </li>
          </ul>
        </div>
      </InstructionsModal>
    </PageShell>
  );
};

export default QrTransfer;
