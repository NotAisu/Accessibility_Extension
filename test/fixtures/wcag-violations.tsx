import React from 'react';

// WCAG 2.2 AA Semantic Violations (React/TypeScript)
const WCAGViolationsTest: React.FC = () => {
    const handleSelectChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
        if (e.target.value) window.location.href = e.target.value;
    };

    return (
        <div>
            <img src="/chart.png" alt="chart" /> {/* 1.1.1: Poor alt quality */}
            <div>• Item</div> {/* 1.3.1: List not marked up semantically */}
            <p>Required fields are <span style={{color: 'red'}}>red</span></p> {/* 1.4.1: Color-only meaning */}
            <a href="/go">Click here</a> {/* 2.4.4: Vague link text */}
            <h2>Information</h2> {/* 2.4.6: Generic heading */}
            <select onChange={handleSelectChange}></select> {/* 3.2.2: Context change on input */}
            <input type="text" placeholder="Name" /> {/* 3.3.2: Missing label */}
            <button aria-label="Upload file">Save</button> {/* 2.5.3: Label-in-name mismatch */}
            <div onClick={() => alert('submit')}>Submit</div> {/* 4.1.2: Interactive element without role */}
            <button></button> {/* 4.1.2: Empty button */}
            <button aria-describedby="nonexistent">Save</button> {/* 4.1.2: aria-describedby missing id */}
            <div role="button" {...({'aria-pressed': 'maybe'} as any)}>Toggle</div> {/* 4.1.2: Invalid ARIA value */}
            <ul role="menu"><li>Item</li></ul> {/* 4.1.2: role=menu without menuitem */}
            <div aria-hidden="true" tabIndex={0}>Hidden</div> {/* 4.1.2: Focusable but aria-hidden */}
            <p>English text, then <span>cette partie est en français</span>.</p> {/* 3.1.2: Language change not marked */}
            <button style={{width: 12, height: 12}}></button> {/* 2.5.8: Target size too small */}
            <a href="#" style={{outline: 'none'}}>Link</a> {/* 2.4.7: Focus visible removed */}
            <select></select> {/* 4.1.2: Select without accessible name */}
            <input onFocus={() => (window.location.href = '/next')} /> {/* 3.2.1: On focus initiates change */}
            <iframe src="/widget" title=""></iframe> {/* 2.4.2: Iframe missing descriptive title */}
        </div>
    );
};

export default WCAGViolationsTest;
