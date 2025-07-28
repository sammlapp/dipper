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
    </span>
  );
}

export default HelpIcon;