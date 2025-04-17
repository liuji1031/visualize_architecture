// Custom type declarations for HTML attributes not included in the standard TypeScript definitions

// Declare a module for JSX elements to include custom attributes
declare namespace JSX {
  interface IntrinsicElements {
    input: React.DetailedHTMLProps<
      React.InputHTMLAttributes<HTMLInputElement> & {
        webkitdirectory?: string;
        directory?: string;
      },
      HTMLInputElement
    >;
  }
}
