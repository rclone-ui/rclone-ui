export interface BackendOption {
    Name: string
    FieldName: string
    Help: string
    Provider?: string
    Default: any
    Value: any
    Examples?: Array<{ Value: string; Help: string }>
    Hide: number
    Required: boolean
    IsPassword: boolean
    NoPrefix: boolean
    Advanced: boolean
    Exclusive: boolean
    Sensitive: boolean
    DefaultStr: string
    ValueStr: string
    Type: string
}

export interface Backend {
    Name: string
    Description: string
    Options: BackendOption[]
    Prefix: string
}

export type FlagValue = string | number | boolean | string[]
