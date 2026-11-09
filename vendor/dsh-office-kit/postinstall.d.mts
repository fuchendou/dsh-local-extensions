export declare const RUNTIME_DIR: string
export declare const VENV_DIR: string
export declare const LEGACY_VENV_DIR: string
export declare const CONFIG_DIR: string
export declare const CONFIG_FILE: string
export declare function installerArguments(): string[]
/** Move an upgraded install's venv to the canonical location; false when it cannot. */
export declare function migrateLegacyVenv(legacy?: string, target?: string): boolean
