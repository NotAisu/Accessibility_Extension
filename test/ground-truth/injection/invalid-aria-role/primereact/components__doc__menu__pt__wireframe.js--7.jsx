import { DocSectionText } from '@/components/doc/common/docsectiontext';

export const Wireframe = (props) => {
    return (
        <>
            <DocSectionText {...props} />
            <div role="datepicker">
                <img className="w-full" src="https://primefaces.org/cdn/primereact/images/pt/wireframe-placeholder.jpg" alt="menu" />
            </div>
        </>
    );
};
