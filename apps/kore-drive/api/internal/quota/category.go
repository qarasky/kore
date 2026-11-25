package quota

import "strings"

// Storage categories for the usage breakdown, by file extension.
const (
	CatImages    = "images"
	CatVideo     = "video"
	CatAudio     = "audio"
	CatDocuments = "documents"
	CatArchives  = "archives"
	CatCode      = "code"
	CatOther     = "other"
)

var categoryByExt = map[string]string{}

func init() {
	for cat, exts := range map[string]string{
		CatImages:    `jpg jpeg png gif webp heic heif avif svg bmp tif tiff ico psd raw cr2 nef arw dng`,
		CatVideo:     `mp4 m4v mkv webm mov avi wmv mpg mpeg 3gp flv mts m2ts`,
		CatAudio:     `mp3 aac m4a ogg oga opus flac wav wma aif aiff mid midi`,
		CatDocuments: `pdf doc docx xls xlsx ppt pptx odt ods odp txt md markdown rtf csv tsv log epub pages numbers key tex rst`,
		CatArchives:  `zip rar 7z tar gz tgz bz2 xz zst lz lzma iso dmg`,
		CatCode: `go rs js jsx ts tsx mjs cjs py rb java kt kts c h cc cpp hpp cs php swift scala sql css scss sass less ` +
			`html htm vue svelte lua pl r sh bash zsh fish ps1 bat cmd json jsonc yaml yml toml xml ini cfg conf env ` +
			`properties gradle dockerfile makefile lock ipynb proto graphql`,
	} {
		for _, e := range strings.Fields(exts) {
			categoryByExt[e] = cat
		}
	}
}

// ExtOf returns name's extension the way extSQL computes it: the text after
// the last '.', ASCII-lowercased ("" without a dot). A dotfile's extension
// is the rest of its name (".env" -> "env"), like path.Ext.
func ExtOf(name string) string {
	i := strings.LastIndexByte(name, '.')
	if i < 0 {
		return ""
	}
	return asciiLower(name[i+1:])
}

// extSQL is ExtOf in SQLite for the name expression col: rtrim() strips
// every trailing non-dot character, leaving the prefix up to the last dot.
// lower() folds ASCII only, as asciiLower does.
func extSQL(col string) string {
	return `CASE WHEN instr(` + col + `,'.')=0 THEN '' ELSE lower(substr(` + col + `,length(rtrim(` + col + `,replace(` + col + `,'.','')))+1)) END`
}

func asciiLower(s string) string {
	return strings.Map(func(r rune) rune {
		if r >= 'A' && r <= 'Z' {
			return r + ('a' - 'A')
		}
		return r
	}, s)
}

// CategoryOfExt maps an extension from ExtOf to its category.
func CategoryOfExt(ext string) string {
	if c, ok := categoryByExt[ext]; ok {
		return c
	}
	return CatOther
}

// CategoryOf returns the storage category of a file name.
func CategoryOf(name string) string { return CategoryOfExt(ExtOf(name)) }
