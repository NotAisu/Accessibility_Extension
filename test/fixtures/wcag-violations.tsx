import React, { useState, useEffect } from 'react';

// WCAG Violations Test Component for React/TypeScript
const WCAGViolationsTest: React.FC = () => {
    const [showModal, setShowModal] = useState<boolean>(false);
    const [formData, setFormData] = useState<{ name: string; email: string }>({ name: '', email: '' });

    // Auto-focus without user control (WCAG 3.2.1)
    useEffect(() => {
        document.getElementById('auto-focus-input')?.focus();
    }, []);

    // Timeout without user control (WCAG 2.2.1)
    useEffect(() => {
        const timer = setTimeout(() => {
            alert('Session expired');
        }, 30000);
        return () => clearTimeout(timer);
    }, []);

    const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        // Form submission without proper validation
    };

    // Context change on input (WCAG 3.2.2)
    const handleSelectChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
        if (e.target.value) {
            window.location.href = e.target.value;
        }
    };

    return (
        <div>
            {/* Missing main landmark */}
            <header>
                <h1>WCAG Violations in TypeScript React</h1>
                {/* Navigation without proper markup */}
                <div className="nav">
                    <a href="/">Home</a>
                    <a href="/about">About</a>
                    <a href="/contact">Contact</a>
                </div>
            </header>

            {/* 1.1.1 Non-text Content */}
            <section>
                <h2>Image Accessibility Issues</h2>
                <img src="/logo.svg" />
                <img src="/chart.png" alt="" />
                <img src="/icon.png" alt="icon" />
                {/* Decorative image with unnecessary alt */}
                <img src="/decoration.jpg" alt="Beautiful decorative pattern" />
                
                {/* Canvas without alternative */}
                <canvas width="300" height="200" id="data-chart">
                    {/* Missing fallback content */}
                </canvas>
            </section>

            {/* 1.3.1 Info and Relationships */}
            <section>
                <h2>Semantic Structure Issues</h2>
                
                {/* Wrong heading hierarchy */}
                <h1>Subsection Title</h1>
                <h4>Should be h3</h4>
                
                {/* Non-semantic interactive elements */}
                <div onClick={() => alert('clicked')} className="fake-button">
                    Submit Form
                </div>
                
                <span onClick={() => setShowModal(true)} className="clickable">
                    Open Modal
                </span>

                {/* Table without proper headers */}
                <table>
                    <tr>
                        <td>Name</td>
                        <td>Age</td>
                        <td>Department</td>
                    </tr>
                    <tr>
                        <td>John Doe</td>
                        <td>30</td>
                        <td>Engineering</td>
                    </tr>
                </table>

                {/* List without proper markup */}
                <div>
                    <div>• First item</div>
                    <div>• Second item</div>
                    <div>• Third item</div>
                </div>
            </section>

            {/* 1.4.3 Contrast violations */}
            <section>
                <h2>Color Contrast Issues</h2>
                <p style={{ color: '#777', background: '#999' }}>
                    Low contrast text
                </p>
                <button style={{ background: '#ccc', color: '#ddd' }}>
                    Poor Contrast Button
                </button>
            </section>

            {/* 2.1.1 Keyboard accessibility */}
            <section>
                <h2>Keyboard Access Issues</h2>
                <div tabIndex={0} onClick={() => console.log('clicked')}>
                    Focusable div without proper role
                </div>
                
                {/* Tab order issues */}
                <input type="text" tabIndex={5} placeholder="Third input" />
                <input type="text" tabIndex={2} placeholder="First input" />
                <input type="text" tabIndex={1} placeholder="Second input" />
            </section>

            {/* 2.4.4 Link Purpose */}
            <section>
                <h2>Link Purpose Issues</h2>
                <a href="/page1">Click here</a>
                <a href="/info">More</a>
                <a href="/details">Read more</a>
                <a href="#"></a>
                <a href="/download.pdf">Download</a>
            </section>

            {/* 2.4.7 Focus Visible */}
            <section>
                <h2>Focus Indicator Issues</h2>
                <button style={{ outline: 'none' }}>
                    Button without focus outline
                </button>
                <a href="#" style={{ outline: 'none' }}>
                    Link without focus
                </a>
            </section>

            {/* 2.5.8 Target Size */}
            <section>
                <h2>Target Size Issues</h2>
                <button style={{ width: '10px', height: '10px' }}>
                    {/* Too small button */}
                </button>
                <a 
                    href="#" 
                    style={{ display: 'inline-block', width: '15px', height: '15px' }}
                >
                    ×
                </a>
            </section>

            {/* 3.2.2 On Input */}
            <section>
                <h2>Context Change Issues</h2>
                <select onChange={handleSelectChange}>
                    <option value="">Select a page</option>
                    <option value="/page1">Page 1</option>
                    <option value="/page2">Page 2</option>
                </select>
            </section>

            {/* 3.3.2 Labels or Instructions */}
            <section>
                <h2>Form Label Issues</h2>
                <form onSubmit={handleSubmit}>
                    <input 
                        type="text" 
                        placeholder="Enter your name"
                        id="auto-focus-input"
                    />
                    <input type="email" />
                    <textarea placeholder="Your message"></textarea>
                    
                    {/* Radio buttons without fieldset */}
                    <div>
                        <input type="radio" name="gender" value="male" /> Male
                        <input type="radio" name="gender" value="female" /> Female
                        <input type="radio" name="gender" value="other" /> Other
                    </div>
                    
                    <button type="submit">Submit</button>
                </form>
            </section>

            {/* 4.1.2 Name, Role, Value */}
            <section>
                <h2>Interactive Element Issues</h2>
                <button></button>
                <button>?</button>
                <input type="submit" />
                
                <select>
                    <option>Option 1</option>
                    <option>Option 2</option>
                </select>
            </section>

            {/* ARIA Misuse */}
            <section>
                <h2>ARIA Issues</h2>
                <div aria-hidden="true" tabIndex={0}>
                    Hidden but focusable content
                </div>
                
                <button 
                    aria-label="Save file" 
                    aria-describedby="nonexistent-id"
                >
                    Save
                </button>
                
                <img src="/icon.png" alt="Icon" aria-label="Icon" />
                
                <div role="button" aria-pressed="maybe" as any>
                    Invalid ARIA value
                </div>

                <ul role="menu">
                    <li>Not a proper menuitem</li>
                    <li>Another improper item</li>
                </ul>
            </section>

            {/* Color-only information */}
            <section>
                <h2>Color Dependency Issues</h2>
                <p>
                    Required fields are marked in <span style={{ color: 'red' }}>red</span>
                </p>
                <p>
                    Valid fields are shown in <span style={{ color: 'green' }}>green</span>
                </p>
            </section>

            {/* Modal without proper focus management */}
            {showModal && (
                <div className="modal-overlay" onClick={() => setShowModal(false)}>
                    <div className="modal">
                        <h3>Modal Title</h3>
                        <p>Modal content without proper focus management</p>
                        <button onClick={() => setShowModal(false)}>Close</button>
                    </div>
                </div>
            )}

            {/* Missing skip links */}
            {/* No skip navigation present */}

            {/* Dynamic content without announcement */}
            <div id="dynamic-content">
                {/* Content changes without screen reader notification */}
            </div>

            {/* Improper iframe usage */}
            <iframe src="/widget" title="" />
            <iframe src="/content" />

            {/* Auto-playing media */}
            <video autoPlay loop muted>
                <source src="/background-video.mp4" type="video/mp4" />
            </video>

            {/* Missing form validation */}
            <section>
                <h2>Form Validation Issues</h2>
                <input 
                    type="text" 
                    style={{ border: '2px solid red' }}
                    aria-invalid="true"
                />
                <span style={{ color: 'red' }}>Error message not associated</span>
            </section>

            {/* Footer without proper landmark */}
            <div className="footer">
                <p>&copy; 2025 Company Name</p>
            </div>
        </div>
    );
};

export default WCAGViolationsTest;
