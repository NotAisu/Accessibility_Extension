// Component Mapping: the user's declaration of which native element a project component renders. It is data from
// the settings only; no project file or code is read or run to find out what a component renders.

export interface ComponentMapping {
    /** Component names as written in the markup (`Button`, `UI.Link`, `app-button`) to the native element each renders. */
    components?: Record<string, string>;
    /** A prop whose literal value names the element any component renders, such as `as` in `<Link as="a">`. */
    polymorphicPropName?: string;
}

/**
 * The native element a component renders, or undefined when the element is not mapped. A literal polymorphic
 * prop names the element first, which the mapping can then map again, as eslint-plugin-jsx-a11y-x does.
 * `kebab`: template languages (Vue, Angular), where `MyButton` and `my-button` name the same component.
 */
export function mappedElement(
    written: string,
    attribute: (name: string) => string | true | undefined,
    mapping: ComponentMapping | undefined,
    kebab = false
): string | undefined {
    if (!mapping) return undefined;
    const polymorphic = mapping.polymorphicPropName ? attribute(mapping.polymorphicPropName) : undefined;
    const name = typeof polymorphic === 'string' && polymorphic ? polymorphic : written;
    const components = mapping.components ?? {};
    // A lowercase name without a hyphen is a native element (<link>), never the component Link
    const key = kebab && /[A-Z-]/.test(name)
        ? Object.keys(components).find(component => kebabCase(component) === kebabCase(name))
        : Object.prototype.hasOwnProperty.call(components, name) ? name : undefined;
    const element = key === undefined ? name : components[key];
    return element === written ? undefined : element;
}

function kebabCase(name: string): string {
    return name.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
}

/** The written name of each element a parser wrapper mapped, by syntax tree node. */
export const writtenNames = new WeakMap<object, string>();
