import React from 'react';

function HelpIcon({ section, className = '' }) {
  const handleClick = () => {
    console.log('Help icon clicked for section:', section);
    
    // Switch to help tab first
    const tabChangeEvent = new CustomEvent('changeTab', {
      detail: { tabId: 'help' }
    });
    window.dispatchEvent(tabChangeEvent);
    
    // Then navigate to the specific section after a delay
    setTimeout(() => {
      const helpNavEvent = new CustomEvent('navigateToHelp', {
        detail: { section }
      });
      window.dispatchEvent(helpNavEvent);
    }, 100);
  };

  return (
    <span 
      className={`help-icon ${className}`}
      onClick={handleClick}
      title="Get help"
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          handleClick();
        }
      }}
    >
      ?
      <style jsx>{`
        .help-icon {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 16px;
          height: 16px;
          border-radius: 50%;
          background-color: var(--secondary, #6c757d);
          color: white;
          font-size: 11px;
          font-weight: bold;
          cursor: pointer;
          margin-left: 6px;
          transition: all 0.2s ease;
          user-select: none;
          vertical-align: middle;
        }

        .help-icon:hover {
          background-color: var(--primary, #1976d2);
          transform: scale(1.1);
        }

        .help-icon:focus {
          outline: 2px solid var(--primary, #1976d2);
          outline-offset: 2px;
        }

        .help-icon:active {
          transform: scale(0.95);
        }
      `}</style>
    </span>
  );
}

export default HelpIcon;