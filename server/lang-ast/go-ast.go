package main

import (
	"encoding/json"
	"fmt"
	"go/ast"
	"go/parser"
	"go/token"
	"os"
)

type Entity struct {
	Kind   string   `json:"kind"`
	Name   string   `json:"name"`
	Line   int      `json:"line"`
	Params []string `json:"params,omitempty"`
}
type Import struct {
	Source string `json:"source"`
	Line   int    `json:"line"`
}
type Snap struct {
	Language string   `json:"language"`
	Entities []Entity `json:"entities"`
	Imports  []Import `json:"imports"`
	Exports  []string `json:"exports"`
}

func main() {
	if len(os.Args) < 2 {
		fmt.Print(`{"ok":false,"error":"missing file"}`)
		return
	}
	f := token.NewFileSet()
	p, e := parser.ParseFile(f, os.Args[1], nil, parser.ParseComments)
	if e != nil {
		fmt.Printf(`{"ok":false,"error":%q}`, e.Error())
		return
	}
	s := Snap{Language: "go", Entities: []Entity{}, Imports: []Import{}, Exports: []string{}}
	for _, d := range p.Decls {
		switch x := d.(type) {
		case *ast.GenDecl:
			for _, sp := range x.Specs {
				if t, ok := sp.(*ast.TypeSpec); ok {
					k := "type"
					if _, ok := t.Type.(*ast.StructType); ok {
						k = "struct"
					}
					if _, ok := t.Type.(*ast.InterfaceType); ok {
						k = "interface"
					}
					s.Entities = append(s.Entities, Entity{Kind: k, Name: t.Name.Name, Line: f.Position(t.Pos()).Line})
				}
			}
		case *ast.FuncDecl:
			en := Entity{Kind: "function", Name: x.Name.Name, Line: f.Position(x.Pos()).Line}
			if x.Recv != nil {
				en.Kind = "method"
			}
			if x.Type.Params != nil {
				for _, p := range x.Type.Params.List {
					en.Params = append(en.Params, fmt.Sprintf("%v", p.Type))
				}
			}
			s.Entities = append(s.Entities, en)
		}
	}
	for _, im := range p.Imports {
		s.Imports = append(s.Imports, Import{Source: im.Path.Value, Line: f.Position(im.Pos()).Line})
	}
	json.NewEncoder(os.Stdout).Encode(map[string]any{"ok": true, "language": "go", "parser": "go/parser", "strength": "real-ast", "snapshot": s})
}
