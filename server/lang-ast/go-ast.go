package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"go/ast"
	"go/parser"
	"go/printer"
	"go/scanner"
	"go/token"
	"os"
	"strconv"
)

type ErrResp struct {
	Ok       bool   `json:"ok"`
	Language string `json:"language"`
	Parser   string `json:"parser"`
	Strength string `json:"strength"`
	Error    string `json:"error"`
	Line     *int   `json:"line"`
	Column   *int   `json:"column"`
}

func formatNode(fset *token.FileSet, node ast.Node) string {
	if node == nil {
		return ""
	}
	var buf bytes.Buffer
	if err := printer.Fprint(&buf, fset, node); err != nil {
		return fmt.Sprintf("%v", node)
	}
	return buf.String()
}

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
	if len(os.Args) < 2 || os.Args[1] == "" {
		json.NewEncoder(os.Stdout).Encode(ErrResp{
			Ok:       false,
			Language: "go",
			Parser:   "go/parser",
			Strength: "real-ast",
			Error:    "missing file argument",
		})
		return
	}
	f := token.NewFileSet()
	p, e := parser.ParseFile(f, os.Args[1], nil, parser.ParseComments)
	if e != nil {
		var linePtr, colPtr *int
		if errList, ok := e.(scanner.ErrorList); ok && len(errList) > 0 {
			l := errList[0].Pos.Line
			c := errList[0].Pos.Column
			linePtr = &l
			colPtr = &c
		} else if scErr, ok := e.(scanner.Error); ok {
			l := scErr.Pos.Line
			c := scErr.Pos.Column
			linePtr = &l
			colPtr = &c
		}
		json.NewEncoder(os.Stdout).Encode(ErrResp{
			Ok:       false,
			Language: "go",
			Parser:   "go/parser",
			Strength: "real-ast",
			Error:    e.Error(),
			Line:     linePtr,
			Column:   colPtr,
		})
		return
	}
	s := Snap{Language: "go", Entities: []Entity{}, Imports: []Import{}, Exports: []string{}}
	for _, d := range p.Decls {
		switch x := d.(type) {
		case *ast.GenDecl:
			for _, sp := range x.Specs {
				switch t := sp.(type) {
				case *ast.TypeSpec:
					k := "type"
					if _, ok := t.Type.(*ast.StructType); ok {
						k = "struct"
					} else if _, ok := t.Type.(*ast.InterfaceType); ok {
						k = "interface"
					}
					s.Entities = append(s.Entities, Entity{Kind: k, Name: t.Name.Name, Line: f.Position(t.Pos()).Line})
					if ast.IsExported(t.Name.Name) {
						s.Exports = append(s.Exports, t.Name.Name)
					}
				case *ast.ValueSpec:
					k := "var"
					if x.Tok == token.CONST {
						k = "const"
					}
					for _, name := range t.Names {
						s.Entities = append(s.Entities, Entity{Kind: k, Name: name.Name, Line: f.Position(name.Pos()).Line})
						if ast.IsExported(name.Name) {
							s.Exports = append(s.Exports, name.Name)
						}
					}
				}
			}
		case *ast.FuncDecl:
			en := Entity{Kind: "function", Name: x.Name.Name, Line: f.Position(x.Pos()).Line}
			if x.Recv != nil {
				en.Kind = "method"
			}
			if x.Type.Params != nil {
				for _, paramField := range x.Type.Params.List {
					formattedType := formatNode(f, paramField.Type)
					if len(paramField.Names) == 0 {
						en.Params = append(en.Params, formattedType)
					} else {
						for _, paramName := range paramField.Names {
							en.Params = append(en.Params, fmt.Sprintf("%s %s", paramName.Name, formattedType))
						}
					}
				}
			}
			s.Entities = append(s.Entities, en)
			if ast.IsExported(x.Name.Name) && x.Recv == nil {
				s.Exports = append(s.Exports, x.Name.Name)
			}
		}
	}
	for _, im := range p.Imports {
		pathVal := im.Path.Value
		if unquoted, err := strconv.Unquote(pathVal); err == nil {
			pathVal = unquoted
		}
		s.Imports = append(s.Imports, Import{Source: pathVal, Line: f.Position(im.Pos()).Line})
	}
	json.NewEncoder(os.Stdout).Encode(map[string]any{"ok": true, "language": "go", "parser": "go/parser", "strength": "real-ast", "snapshot": s})
}
