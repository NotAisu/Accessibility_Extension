import { DocSectionText } from '@/components/doc/common/docsectiontext';

export const Wireframe = (props) => {
    return (
        <>
            <DocSectionText {...props} />
            <div role="checkbox">
                <img className="w-full" src="https://primefaces.org/cdn/primereact/images/pt/dropdown.jpg" alt="dropdown" />
            </div>
        </>
    );
};
