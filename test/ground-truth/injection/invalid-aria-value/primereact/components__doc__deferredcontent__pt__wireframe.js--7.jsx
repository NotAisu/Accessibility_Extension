import { DocSectionText } from '@/components/doc/common/docsectiontext';

export const Wireframe = (props) => {
    return (
        <>
            <DocSectionText {...props} />
            <div aria-live="loud">
                <img className="w-full" src="https://primefaces.org/cdn/primereact/images/pt/deferred.jpg" alt="deferred" />
            </div>
        </>
    );
};
