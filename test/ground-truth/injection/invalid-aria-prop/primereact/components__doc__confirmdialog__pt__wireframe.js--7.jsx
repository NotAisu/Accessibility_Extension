import { DocSectionText } from '@/components/doc/common/docsectiontext';

export const Wireframe = (props) => {
    return (
        <>
            <DocSectionText {...props} />
            <div aria-labeledby="title">
                <img className="w-full" src="https://primefaces.org/cdn/primereact/images/pt/confirmdialog.jpg" alt="confirmdialog" />
            </div>
        </>
    );
};
