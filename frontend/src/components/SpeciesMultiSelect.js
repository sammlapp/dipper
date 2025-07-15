import Select from 'react-select';

function SpeciesMultiSelect({ 
  availableSpecies = [], 
  selectedSpecies = [], 
  onSelectionChange,
  placeholder = "Type to search and select species..."
}) {
  // Convert species arrays to react-select format
  const options = availableSpecies.map(species => ({
    value: species,
    label: species
  }));

  const selectedOptions = selectedSpecies.map(species => ({
    value: species,
    label: species
  }));

  const handleChange = (selectedOptions) => {
    const species = selectedOptions ? selectedOptions.map(option => option.value) : [];
    onSelectionChange(species);
  };

  // Custom styles to match the app theme
  const customStyles = {
    control: (provided, state) => ({
      ...provided,
      borderColor: state.isFocused ? 'var(--dark-accent)' : 'var(--border)',
      borderWidth: '2px',
      borderRadius: '8px',
      boxShadow: state.isFocused ? '0 0 0 3px rgba(79, 93, 117, 0.1)' : 'none',
      fontSize: '1rem',
      minHeight: '48px',
      '&:hover': {
        borderColor: 'var(--dark-accent)'
      }
    }),
    multiValue: (provided) => ({
      ...provided,
      backgroundColor: 'var(--dark-accent)',
      borderRadius: '4px',
    }),
    multiValueLabel: (provided) => ({
      ...provided,
      color: 'var(--white)',
      fontSize: '0.8rem',
      fontWeight: '500'
    }),
    multiValueRemove: (provided) => ({
      ...provided,
      color: 'var(--white)',
      '&:hover': {
        backgroundColor: 'var(--dark)',
        color: 'var(--white)',
      }
    }),
    option: (provided, state) => ({
      ...provided,
      backgroundColor: state.isSelected 
        ? 'var(--dark-accent)' 
        : state.isFocused 
        ? 'var(--light-bg)' 
        : 'var(--white)',
      color: state.isSelected ? 'var(--white)' : 'var(--dark)',
      fontSize: '0.9rem',
      '&:hover': {
        backgroundColor: state.isSelected ? 'var(--dark-accent)' : 'var(--light-bg)'
      }
    }),
    menu: (provided) => ({
      ...provided,
      borderRadius: '8px',
      border: '2px solid var(--border)',
      boxShadow: '0 4px 8px var(--shadow)',
      zIndex: 1000
    }),
    placeholder: (provided) => ({
      ...provided,
      color: 'var(--medium-gray)',
      fontStyle: 'italic'
    }),
    input: (provided) => ({
      ...provided,
      color: 'var(--dark)'
    }),
    indicatorSeparator: (provided) => ({
      ...provided,
      backgroundColor: 'var(--border)'
    }),
    dropdownIndicator: (provided) => ({
      ...provided,
      color: 'var(--medium-gray)',
      '&:hover': {
        color: 'var(--dark-accent)'
      }
    }),
    clearIndicator: (provided) => ({
      ...provided,
      color: 'var(--medium-gray)',
      '&:hover': {
        color: 'var(--alert)'
      }
    })
  };

  return (
    <div className="species-multiselect">
      <label>
        <strong>Species to Display:</strong>
        <div style={{ marginTop: '0.5rem' }}>
          <Select
            isMulti
            options={options}
            value={selectedOptions}
            onChange={handleChange}
            placeholder={placeholder}
            styles={customStyles}
            className="basic-multi-select"
            classNamePrefix="select"
            isClearable
            isSearchable
            menuPlacement="auto"
            maxMenuHeight={300}
            closeMenuOnSelect={false}
            hideSelectedOptions={false}
            blurInputOnSelect={false}
            noOptionsMessage={({ inputValue }) => 
              inputValue ? `No species found matching "${inputValue}"` : "No species available"
            }
          />
        </div>
      </label>
    </div>
  );
}

export default SpeciesMultiSelect;