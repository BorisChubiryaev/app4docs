import React from 'react';
import { Link } from 'react-router-dom';
import './Header.css';

interface HeaderProps {
  title?: string;
  description?: string;
  onShowInstructions?: () => void;
  showHomeButton?: boolean;
  showInstructionsButton?: boolean;
}

const Header: React.FC<HeaderProps> = ({
  title = "",
  description = "",
  onShowInstructions,
  showHomeButton = true,
  showInstructionsButton = true,
}) => {
  return (
    <div className="pdf2pptx-header">
      <div className="header-content">
        <div className="header-buttons">
          {showHomeButton && (
            <Link to="/" className="instructions-button">
              🏠 На главную
            </Link>
          )}
          
          <div className="header-title">
            <h1>{title}</h1>
            <p>{description}</p>
          </div>
          
          {showInstructionsButton && onShowInstructions && (
            <button
              className="instructions-button"
              onClick={onShowInstructions}
              aria-label="Показать инструкцию"
            >
              📚 Инструкция
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default Header;
