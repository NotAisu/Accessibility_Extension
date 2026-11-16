export const Newsletter = ({ tone }: { tone: string }) => (
    <form style={{ backgroundColor: '#ffffff' }}>
        <p style={{ color: '#aaaaaa' }}>We send one email a month.</p>
        <p style={{ color: '#595959' }}>Unsubscribe at any time.</p>
        <p style={{ color: tone }}>Read our privacy policy.</p>
    </form>
);
