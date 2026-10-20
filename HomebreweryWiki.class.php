<?php
/**
 * HomebreweryWiki extension core class.
 *
 * PHP 5.2 compatible: no namespaces, no closures, no short array syntax.
 *
 * @file
 */

if ( !defined( 'MEDIAWIKI' ) ) {
    die( 'This file is a MediaWiki extension and must not be loaded directly.' );
}

/**
 * Core setup and shared helpers for the HomebreweryWiki extension.
 *
 * The entry point (HomebreweryWiki.php) registers credits, i18n, the brew
 * namespace (E1S1T2, at load time) and this class.  setup() still does nothing;
 * the brew content type lands here in E1S1T3.
 */
class HomebreweryWiki {

    /**
     * The normalized source of the edit form currently being rendered
     * (E1S4).  EditPage::importFormData() trims the posted textbox, so using
     * the raw request would make preview and saved view differ by trailing
     * whitespace.  Captured in EditPage::showEditForm:initial and consumed by
     * the preview OutputPageBeforeHTML handler in the same request.
     *
     * @var string|null
     */
    public static $previewSourceText = null;

    /**
     * Whether the edit form being rendered is a preview (E1S4).  EditPage
     * derives this itself: a submitted preview sets formtype='preview', and so
     * does preview-on-open, which previewOnOpen() can enable through the
     * `previewonfirst` user preference without any wpPreview / preview=yes
     * request flag.  Captured in EditPage::showEditForm:initial so the shared
     * preview predicate sees all three entry points.
     *
     * @var bool
     */
    public static $editFormPreview = false;

    /**
     * Whether the next OutputPageBeforeHTML preview body may be replaced
     * (E1S4).  OutputPageBeforeHTML also fires for every parsed fragment added
     * through OutputPage::addParserOutput() (edit notices, tools, warnings) and
     * for diffs, so a request-level check alone could clobber unrelated output.
     * Armed only by EditPage::showEditForm:initial for a brew preview, and
     * cleared after the single preview body (marked by `previewnote`) is
     * swapped.
     *
     * @var bool
     */
    public static $previewArmed = false;

    /**
     * $wgExtensionFunctions entry point.  Called once, after MediaWiki is
     * fully initialised.
     *
     * @return void
     */
    public static function setup() {
        // Intentionally empty for the "empty extension" skeleton.
        // Later tasks append registration work here.
    }

    /**
     * ArticleFromTitle hook.  Return a brew-aware Article subclass for pages in
     * the brew namespace so that brew pages are first-class.
     *
     * MediaWiki 1.14 signature: ( &$title, &$article ) - two args, no $context
     * (that is a 1.18+ addition).
     *
     * @param Title   &$title   Page title.
     * @param Article &$article Article object, or null.
     * @return bool Always true so other handlers keep running.
     */
    public static function onArticleFromTitle( &$title, &$article ) {
        $brew = HomebreweryWiki_Article::newFromTitle( $title );
        if ( $brew !== null ) {
            $article = $brew;
        }
        return true;
    }

    /**
     * Whether a namespace id belongs to the brew content type (E2S1).
     *
     * @param int $ns Namespace id.
     * @return bool
     */
    public static function isBrewNamespace( $ns ) {
        return $ns === NS_MANUAL || $ns === NS_MANUAL_TALK;
    }

    /**
     * userCan hook (E2S1).  Deny edit/create on brew pages to accounts without
     * the brew-edit right, leaving read and every other action untouched so
     * brew pages keep inheriting the global read policy (E2S3).
     *
     * MediaWiki 1.14 signature: ( &$title, &$user, $action, &$result ).
     * Returning false with $result = false yields a permission error
     * (badaccess-group0); returning true lets the stock checks run.
     *
     * @param Title &$title  Page being checked.
     * @param User  &$user   User performing the action.
     * @param string $action Action being checked (edit, read, move, ...).
     * @param bool  &$result Hook result (set false to deny).
     * @return bool True to continue with the stock permission checks.
     */
    public static function onUserCan( &$title, &$user, $action, &$result ) {
        if ( ! ( $title instanceof Title ) ) {
            return true;
        }
        if ( $action !== 'edit' && $action !== 'create' ) {
            return true;
        }
        if ( ! HomebreweryWiki::isBrewNamespace( $title->getNamespace() ) ) {
            return true;
        }
        if ( $user instanceof User && $user->isAllowed( HOMEBREWERYWIKI_EDIT_RIGHT ) ) {
            return true;
        }
        $result = false;
        return false;
    }

    /**
     * Whether an upload of $size bytes is within the extension's limit (E2S2).
     *
     * @param mixed $size File size in bytes, as reported by filesize().
     * @return bool True when the size is known and at or below the 10 MB cap.
     */
    public static function isUploadSizeAllowed( $size ) {
        if ( !is_numeric( $size ) ) {
            return false;
        }
        $size = (int)$size;
        return $size >= 0 && $size <= HOMEBREWERYWIKI_MAX_UPLOAD_SIZE;
    }

    /**
     * UploadVerification hook (E2S2).  On MediaWiki 1.14 $wgMaxUploadSize only
     * covers URL-copy uploads, so local uploads are checked here against the
     * same 10 MB cap before the file is stored.
     *
     * MediaWiki 1.14 signature: ( $destName, $tempPath, &$error ).
     *
     * @param string $destName Destination file name (unused).
     * @param string $tempPath Path to the uploaded temporary file.
     * @param string &$error  Error message shown to the user on rejection.
     * @return bool False to reject the upload.
     */
    public static function onUploadVerification( $destName, $tempPath, &$error ) {
        $size = @filesize( $tempPath );
        if ( $size === false || ! HomebreweryWiki::isUploadSizeAllowed( $size ) ) {
            // 1.14 does not lazily load extension messages outside core paths.
            wfLoadExtensionMessages( 'HomebreweryWiki' );
            $error = wfMsg( 'homebrewerywiki-upload-too-large' );
            return false;
        }
        return true;
    }

    /**
     * ArticleSave hook.  Reject brew saves whose source is not valid UTF-8
     * text, so a corrupt revision can never be stored (E1S1T7).
     *
     * MediaWiki 1.14 signature:
     *   array( &$this, &$user, &$text, &$summary, $minor, $watch, $section,
     *          &$flags, &$status )
     *
     * @return bool False to abort the save, true otherwise.
     */
    public static function onArticleSave( &$article, &$user, &$text, &$summary, $minor, $watch, $section, &$flags, &$status ) {
        if ( ! ( $article instanceof Article ) ||
             $article->getTitle()->getNamespace() !== NS_MANUAL ) {
            return true;
        }
        if ( ! HomebreweryWiki::isValidBrewText( $text ) ) {
            $status = Status::newFatal( 'homebrewerywiki-invalid-brew-text' );
            return false;
        }
        return true;
    }

    /**
     * ArticleSaveComplete hook (E3.5S3T4).  Brew views skip the wikitext
     * parser, so `pagelinks` / `categorylinks` would never be updated.  Build
     * the link set from the source tokens and run LinksUpdate, which makes
     * Special:WhatLinksHere and category pages work without touching the
     * stored markdown.
     *
     * MediaWiki 1.14 signature (ArticleSaveComplete):
     *   ( &$article, &$user, $text, $summary, $minoredit, $watchthis,
     *     $sectionanchor, &$flags, $revision, &$status, $baseRevId )
     *
     * @return bool Always true.
     */
    public static function onArticleSaveComplete( &$article, &$user, $text, $summary,
        $minoredit, $watchthis, $sectionanchor, &$flags, $revision, &$status ) {
        if ( !( $article instanceof Article ) ||
             $article->getTitle()->getNamespace() !== NS_MANUAL ) {
            return true;
        }
        if ( !is_string( $text ) || !class_exists( 'ParserOutput' ) ||
             !class_exists( 'LinksUpdate' ) ) {
            return true;
        }

        $output = new ParserOutput();

        foreach ( self::brewLinkTargets( $text ) as $target ) {
            $title = Title::newFromText( $target );
            if ( $title instanceof Title && $title->getNamespace() !== NS_MEDIA ) {
                $output->addLink( $title );
            }
        }
        foreach ( self::brewCategoryNames( $text ) as $category ) {
            $key = self::categoryDbKey( $category );
            if ( $key !== null && $key !== '' ) {
                $output->addCategory( $key, '' );
            }
        }
        // 1.14 images are registered as links too, so `[[File:...]]` shows up
        // in the file's "what links here".
        foreach ( self::brewFileMap( $text ) as $name => $info ) {
            $fileTitle = Title::makeTitleSafe( NS_FILE, $name );
            if ( $fileTitle instanceof Title ) {
                $output->addLink( $fileTitle );
            }
        }

        $update = new LinksUpdate( $article->getTitle(), $output, false );
        $update->doUpdate();
        return true;
    }

    /**
     * Whether $text is safe to treat as brew source (E1S1T7): a string that is
     * empty or valid UTF-8.
     *
     * On 1.14 the framework already stores and returns article text as a plain
     * string, so brew revisions are never rewritten by this extension.  This
     * predicate lets load/save callers reject malformed data instead of letting
     * it corrupt downstream handling.
     *
     * @param mixed $text
     * @return bool
     */
    public static function isValidBrewText( $text ) {
        if ( !is_string( $text ) ) {
            return false;
        }
        if ( $text === '' ) {
            return true;
        }
        // preg_match() returns false on malformed UTF-8, 1 otherwise.
        return ( preg_match( '//u', $text ) === 1 );
    }

    /**
     * Whether the renderer bundle must load for this request (E1S3T1, E1S4).
     *
     * Kept a pure predicate so the enqueue rule is unit-testable without an
     * OutputPage or a live request.  The bundle loads for an ordinary *view*
     * of a brew-namespace page and for a brew edit *preview* (E1S4: preview
     * runs through the same render path, DESIGN D3).  Edit, history, purge,
     * diffs, and every non-brew page stay excluded.
     *
     * @param Title|mixed $title   Page title (or anything; non-Title => false).
     * @param string      $action  Requested action, e.g. 'view', 'edit'.
     * @param mixed       $diff    Raw 'diff' request value (null when absent).
     * @param bool        $preview Whether the request asked for a preview.
     * @return bool
     */
    public static function shouldEnqueueRenderer( $title, $action, $diff, $preview = false ) {
        if ( !( $title instanceof Title ) ) {
            return false;
        }
        if ( $title->getNamespace() !== NS_MANUAL ) {
            return false;
        }
        if ( $diff !== null ) {
            return false;
        }
        if ( $action === 'view' ) {
            return true;
        }
        // Preview posts action=submit; a reopening edit form can also ask for
        // preview with action=edit&preview=yes (EditPage::previewOnOpen).
        return ( $preview && ( $action === 'submit' || $action === 'edit' ) );
    }

    /**
     * Whether the current request asks for an edit preview (E1S4).
     *
     * MediaWiki 1.14 previews arrive four ways: the Show preview button
     * (wpPreview), the live-preview button (wpLivePreview, which we downgrade to
     * a normal submit), preview-on-open (preview=yes), and preview-on-open from
     * the `previewonfirst` preference, which carries no request flag at all and
     * is recognised through EditPage's formtype.
     *
     * @param WebRequest|mixed $request Request object (non-object => false).
     * @return bool
     */
    public static function isPreviewRequest( $request ) {
        if ( !is_object( $request ) || !method_exists( $request, 'getCheck' ) ) {
            return false;
        }
        if ( self::$editFormPreview ) {
            return true;
        }
        if ( $request->getCheck( 'wpPreview' ) || $request->getCheck( 'wpLivePreview' ) ) {
            return true;
        }
        return ( $request->getVal( 'preview' ) === 'yes' );
    }

    /**
     * Whether this request is a brew-namespace preview render (E1S4).
     *
     * Pure predicate: a preview for a Manual: page, not a diff.  Used by the
     * OutputPageBeforeHTML handler that swaps the mangled wikitext preview for
     * the hidden-source placeholder the render module consumes.
     *
     * @param Title|mixed $title   Page title.
     * @param bool        $preview Whether a preview was requested.
     * @param mixed       $diff    Raw 'diff' request value.
     * @return bool
     */
    public static function isBrewPreview( $title, $preview, $diff ) {
        if ( !( $title instanceof Title ) ) {
            return false;
        }
        if ( $title->getNamespace() !== NS_MANUAL ) {
            return false;
        }
        if ( !$preview || $diff !== null ) {
            return false;
        }
        return true;
    }

	/**
	 * Renderer assets in load order (E1S3T1, pinned renderer E3S2T1):
	 * the pinned Homebrewery v3 renderer, the marked fallback for browsers
	 * that cannot parse it, the sanitizer, then the module that reads the
	 * hidden source and fills the pane. Kept as a pure list so unit tests can
	 * assert order without OutputPage.
	 *
	 * @return array Script paths relative to $wgScriptPath.
	 */
	public static function rendererAssets() {
		return array(
			HOMEBREWERYWIKI_HOMEBREWERY_LIB,
			HOMEBREWERYWIKI_MARKED_LIB,
			HOMEBREWERYWIKI_PURIFY_LIB,
			HOMEBREWERYWIKI_RENDER_MODULE,
		);
	}

	/**
	 * Parent-side stylesheets in load order (E3.5S1).
	 *
	 * This is the host/shell layer only: iframe sizing, frame border and the
	 * plain-source fallback. The D&D theme lives inside the iframe, so no
	 * theme rule is enqueued into the wiki document (Q25 / E3B6).
	 *
	 * @return array Style paths relative to $wgScriptPath.
	 */
	public static function rendererStyles() {
		return array(
			HOMEBREWERYWIKI_THEME_CSS,
		);
	}

	/**
	 * Brew source with code spans and fenced blocks removed.
	 *
	 * Source tokens are extracted from prose only, matching the renderer:
	 * `[[...]]` inside inline code or a fence stays literal on the page, so
	 * it must not register a category, a link or a file (E3.5S3T4).
	 *
	 * Fences close only on a line that uses the same marker character, has a
	 * marker run at least as long as the opener, and has nothing but
	 * whitespace after the run. Inline code spans match CommonMark: the
	 * closing run must be the same length as the opening run.
	 *
	 * @param mixed $text Raw brew markdown.
	 * @return string Prose text, one entry per line.
	 */
	public static function brewProseText( $text ) {
		if ( !is_string( $text ) ) {
			return '';
		}
		$out = array();
		$fenceChar = '';
		$fenceLength = 0;
		$lines = preg_split( "/\r\n|\n|\r/", $text );
		foreach ( $lines as $line ) {
			if ( $fenceChar !== '' ) {
				$close = '/^ {0,3}' . preg_quote( $fenceChar, '/' ) .
					'{' . $fenceLength . ',}[ \t]*$/';
				if ( preg_match( $close, $line ) ) {
					$fenceChar = '';
					$fenceLength = 0;
				}
				continue;
			}
			if ( preg_match( '/^ {0,3}(`{3,}|~{3,})/', $line, $m ) ) {
				$fenceChar = substr( $m[1], 0, 1 );
				$fenceLength = strlen( $m[1] );
				continue;
			}
			$out[] = self::stripInlineCode( $line );
		}
		return implode( "\n", $out );
	}

	/**
	 * Remove inline code spans from one prose line (E3.5S3T4).
	 *
	 * Mirrors the renderer's maskInlineCode(): a run of N backticks closes
	 * only on the next run of exactly N backticks; an unmatched opener stays
	 * literal prose.
	 *
	 * @param string $line One source line.
	 * @return string Line without code spans.
	 */
	protected static function stripInlineCode( $line ) {
		$out = '';
		$len = strlen( $line );
		$i = 0;
		while ( $i < $len ) {
			if ( $line[$i] !== '`' ) {
				$out .= $line[$i];
				$i++;
				continue;
			}
			$open = $i;
			while ( $i < $len && $line[$i] === '`' ) {
				$i++;
			}
			$run = $i - $open;
			$close = -1;
			$j = $i;
			while ( $j < $len ) {
				if ( $line[$j] !== '`' ) {
					$j++;
					continue;
				}
				$k = $j;
				while ( $k < $len && $line[$k] === '`' ) {
					$k++;
				}
				if ( ( $k - $j ) === $run ) {
					$close = $k;
					break;
				}
				$j = $k;
			}
			if ( $close === -1 ) {
				$out .= substr( $line, $open, $i - $open );
			} else {
				$i = $close;
			}
		}
		return $out;
	}

	/**
	 * Category names declared in brew source (E3.5S3T4).
	 *
	 * `[[Category:Name]]` / `[[Category:Name|sort]]` are source-level tokens:
	 * the renderer never sees them, and the page is registered under each
	 * category through OutputPage (view) and LinksUpdate (save). Tokens in
	 * code spans and fences are ignored (brewProseText).
	 *
	 * @param mixed $text Raw brew markdown.
	 * @return array Unique category names, in source order.
	 */
	public static function brewCategoryNames( $text ) {
		$names = array();
		if ( !is_string( $text ) ) {
			return $names;
		}
		$text = self::brewProseText( $text );
		if ( preg_match_all( '/\[\[Category:([^\]|]+)(?:\|[^\]]*)?\]\]/i', $text, $m ) ) {
			foreach ( $m[1] as $name ) {
				$name = trim( $name );
				if ( $name !== '' && !isset( $names[$name] ) ) {
					$names[$name] = true;
				}
			}
		}
		return array_keys( $names );
	}

	/**
	 * Database key for a category name (E3.5S3T4).
	 *
	 * `categorylinks.cl_to` and OutputPage::addCategoryLinks() use the
	 * namespace-less page_title form (underscores), not the display name.
	 *
	 * @param string $name Category display name.
	 * @return string|null DB key, or null when the title is invalid.
	 */
	public static function categoryDbKey( $name ) {
		$name = trim( $name );
		if ( class_exists( 'Title' ) ) {
			$title = Title::makeTitleSafe( NS_CATEGORY, $name );
			if ( $title instanceof Title ) {
				return $title->getDBkey();
			}
			// MediaWiki rejected the name (invalid characters, empty after
			// normalisation); do not invent a key the parser would refuse.
			return null;
		}
		return str_replace( ' ', '_', $name );
	}

	/**
	 * Wiki-link targets declared in brew source (E3.5S3T4).
	 *
	 * Excludes `[[Category:...]]` and `[[File:...]]`, which register through
	 * the category and image paths instead. Tokens in code spans and fences
	 * are ignored (brewProseText).
	 *
	 * @param mixed $text Raw brew markdown.
	 * @return array Unique target titles, in source order.
	 */
	public static function brewLinkTargets( $text ) {
		$targets = array();
		if ( !is_string( $text ) ) {
			return $targets;
		}
		$text = self::brewProseText( $text );
		if ( preg_match_all( '/\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/', $text, $m ) ) {
			foreach ( $m[1] as $target ) {
				$target = trim( $target );
				if ( $target === '' ) {
					continue;
				}
				if ( preg_match( '/^(Category|File):/i', $target ) ) {
					continue;
				}
				if ( !isset( $targets[$target] ) ) {
					$targets[$target] = true;
				}
			}
		}
		return array_keys( $targets );
	}

	/**
	 * Resolve `[[File:...]]` tokens to same-origin upload URLs (E3.5S3T3).
	 *
	 * The client cannot derive MediaWiki's hashed upload paths, so the server
	 * resolves each referenced file once and hands the render module a map.
	 * Missing files are reported as `exists => false` so the module can render
	 * a visible placeholder instead of a broken image (D2). Tokens in code
	 * spans and fences are ignored (brewProseText).
	 *
	 * @param mixed $text Raw brew markdown.
	 * @return array File name => array( 'url' => string, 'exists' => bool ).
	 */
	public static function brewFileMap( $text ) {
		$map = array();
		if ( !is_string( $text ) ) {
			return $map;
		}
		$text = self::brewProseText( $text );
		if ( !preg_match_all( '/\[\[File:([^\]|]+)(?:\|[^\]]*)?\]\]/i', $text, $m ) ) {
			return $map;
		}
		foreach ( $m[1] as $name ) {
			$name = trim( $name );
			if ( $name === '' || isset( $map[$name] ) ) {
				continue;
			}
			$url = '';
			$exists = false;
			if ( class_exists( 'Image' ) ) {
				$image = Image::newFromName( $name );
				if ( $image && $image->exists() ) {
					$url = $image->getURL();
					$exists = ( $url !== '' );
				}
			}
			$map[$name] = array( 'url' => $url, 'exists' => $exists );
		}
		return $map;
	}

	/**
	 * URL of the static iframe shell document (E3.5S1).
	 *
	 * The shell is a plain static file served by the web server; the parent
	 * injects the sanitized page DOM into it. MediaWiki 1.14 has no resource
	 * loader, so the URL is built from $wgScriptPath like the other assets.
	 *
	 * @return string
	 */
	public static function shellUrl() {
		global $wgScriptPath;
		return $wgScriptPath . '/extensions/HomebreweryWiki/HomebreweryWiki.shell.html';
	}

	/**
	 * URL of the compiled upstream theme CSS loaded inside the iframe
	 * (E3.5S2). Override $wgHomebreweryWikiThemeCss in LocalSettings.php to
	 * point at an admin-supplied theme directory; the default is the vendored
	 * build artifact.
	 *
	 * @return string
	 */
	public static function themeCssUrl() {
		global $wgHomebreweryWikiThemeCss, $wgScriptPath;
		if ( is_string( $wgHomebreweryWikiThemeCss ) && $wgHomebreweryWikiThemeCss !== '' ) {
			return $wgHomebreweryWikiThemeCss;
		}
		return $wgScriptPath . '/extensions/HomebreweryWiki/vendor/homebrewery-3.21.0/theme/theme.css';
	}

	/**
	 * Whether this request is the printable/print route (E3.5S4).
	 *
	 * MediaWiki 1.14 exposes the printable view as `printable=yes`; the print
	 * route reuses the same iframe shell full-window rather than printing the
	 * wiki page with brew CSS injected.
	 *
	 * @param WebRequest|mixed $request Request object.
	 * @return bool
	 */
	public static function isPrintRequest( $request ) {
		if ( !is_object( $request ) || !method_exists( $request, 'getVal' ) ) {
			return false;
		}
		return ( $request->getVal( 'printable' ) === 'yes' );
	}

    /**
     * BeforePageDisplay hook.  Loads the renderer bundle for brew page views
     * (E1S3T1) and brew edit previews (E1S4).  Non-brew pages, plain edit,
     * history screens and diffs receive no brew module, so nothing outside a
     * brew view/preview is affected.
     *
     * MediaWiki 1.14 signature: ( &$out, &$sk ).
     *
     * @param OutputPage &$out
     * @param Skin       &$sk
     * @return bool Always true so other handlers keep running.
     */
    public static function onBeforePageDisplay( &$out, &$sk ) {
        global $wgRequest, $wgScriptPath, $wgTitle;

        // 1.14 OutputPage has no getTitle(); the current Title is the $wgTitle
        // global (it is null/absent on some request types, which we treat as
        // "not a brew view").
        $title   = $wgTitle;
        $action  = $wgRequest->getVal( 'action', 'view' );
        $diff    = $wgRequest->getVal( 'diff' );
        $preview = self::isPreviewRequest( $wgRequest );

        if ( ! self::shouldEnqueueRenderer( $title, $action, $diff, $preview ) ) {
            return true;
        }

        foreach ( self::rendererAssets() as $asset ) {
            $out->addScriptFile( $wgScriptPath . $asset );
        }
        foreach ( self::rendererStyles() as $style ) {
            $out->addStyle( $wgScriptPath . $style, 'screen' );
        }
        return true;
    }

    /**
     * OutputPageBeforeHTML hook.  Makes the brew edit preview run through the
     * view render path (E1S4, DESIGN D3).
     *
     * The stock 1.14 preview runs the editor's markdown through the wikitext
     * parser, which mangles it.  On a brew preview we drop that parsed body and
     * emit the very same hidden-source placeholder the saved view emits, so
     * HomebreweryWiki.render.js renders preview and view with one code path.
     * The "Preview" heading and preview notice are kept.
     *
     * MediaWiki 1.14 signature: ( &$out, &$text ).  EditPage::showPreview()
     * fires this explicitly for previews, but OutputPage::addParserOutput()
     * (edit notices, edit tools, warnings) and DifferenceEngine fire it too, so
     * the handler runs only when EditPage::showEditForm:initial armed it for a
     * brew preview *and* the fragment is the stock preview body (its
     * `previewnote` marker is present).  It disarms after that single swap.
     *
     * @param OutputPage &$out  Output page being built.
     * @param string     &$text Preview HTML (replaced on a brew preview).
     * @return bool Always true.
     */
    public static function onOutputPageBeforeHTML( &$out, &$text ) {
        global $wgTitle, $wgRequest, $wgArticle;

        $preview = self::isPreviewRequest( $wgRequest );
        $diff    = $wgRequest->getVal( 'diff' );

        if ( !self::$previewArmed ||
             ! self::isBrewPreview( $wgTitle, $preview, $diff ) ||
             strpos( $text, 'previewnote' ) === false ) {
            return true;
        }
        // Single shot: the preview body appears once per render.
        self::$previewArmed = false;

        $source = ( self::$previewSourceText !== null )
            ? self::$previewSourceText
            : self::previewSource( $wgRequest, $wgArticle );
        if ( ! self::isValidBrewText( $source ) ) {
            return true;
        }

        $note = $out->parse( wfMsg( 'previewnote' ) );

        $text = '<h2>' . htmlspecialchars( wfMsg( 'preview' ) ) . "</h2>\n"
              . '<div class="previewnote">' . $note . "</div>\n"
              . self::brewPlaceholder( $source, false );
        return true;
    }

    /**
     * EditPage::showEditForm:initial hook.  Capture the normalized textbox for
     * the brew preview (E1S4T2).
     *
     * The form render is the point where EditPage has already parsed and
     * trimmed the submitted text, so this is the exact source a save would
     * store.  EditPage also knows here whether this is a preview (formtype),
     * which covers preview-on-open via the `previewonfirst` preference even
     * when the request carries no preview flag.  The preview body replacement
     * is armed on the same condition.
     *
     * MediaWiki 1.14 signature: ( &$editpage ).
     *
     * @param EditPage &$editpage Edit form being rendered.
     * @return bool Always true.
     */
    public static function onEditPageShowEditFormInitial( &$editpage ) {
        self::$previewSourceText = null;
        self::$editFormPreview = false;
        self::$previewArmed = false;

        if ( !( $editpage instanceof EditPage ) ) {
            return true;
        }
        if ( !( $editpage->mTitle instanceof Title ) ||
             $editpage->mTitle->getNamespace() !== NS_MANUAL ) {
            return true;
        }

        self::$editFormPreview = ( $editpage->formtype === 'preview' );
        self::$previewArmed = self::$editFormPreview;
        self::$previewSourceText = $editpage->textbox1;
        return true;
    }

    /**
     * Resolve the source being previewed (E1S4T2).
     *
     * A posted preview carries the editor's unsaved text in wpTextbox1; a
     * preview-on-open (preview=yes) has no POST body, so the saved article text
     * is the only source.  The EditPage hook above normally supplies the exact
     * normalized text; this is the fallback, with the same trailing-whitespace
     * trim EditPage applies, so preview and saved view agree byte for byte.
     *
     * @param WebRequest|mixed $request Request object.
     * @param Article|mixed    $article Current article, when available.
     * @return string Raw brew markdown ('' when nothing is resolvable).
     */
    public static function previewSource( $request, $article ) {
        if ( is_object( $request ) && method_exists( $request, 'wasPosted' ) &&
             $request->wasPosted() ) {
            // Mirror EditPage::safeUnicodeInput(), which rtrims the textbox.
            return rtrim( $request->getText( 'wpTextbox1' ) );
        }
        if ( $article instanceof Article ) {
            return $article->getContent();
        }
        return '';
    }

    /**
     * EditPageBeforeEditButtons hook.  Downgrades the 1.14 AJAX "live preview"
     * button to a normal server-side preview on brew pages (E1S4).
     *
     * Live preview builds its XML from EditPage::getPreviewText() directly and
     * never fires OutputPageBeforeHTML, so it would bypass the shared render
     * path.  Without its onclick handler the button simply posts
     * wpLivePreview, which EditPage already treats as a preview.
     *
     * MediaWiki 1.14 signature: ( &$editpage, &$buttons, &$tabindex ).
     *
     * @param EditPage &$editpage Edit form being rendered.
     * @param array    &$buttons  Button HTML keyed by name.
     * @param int      &$tabindex Current tabindex.
     * @return bool Always true.
     */
    public static function onEditPageBeforeEditButtons( &$editpage, &$buttons, &$tabindex ) {
        global $wgTitle;

        if ( !( $wgTitle instanceof Title ) || $wgTitle->getNamespace() !== NS_MANUAL ) {
            return true;
        }
        if ( isset( $buttons['live'] ) && is_string( $buttons['live'] ) ) {
            $buttons['live'] = preg_replace( '/\sonclick="[^"]*"/', '', $buttons['live'] );
        }
        return true;
    }

    /**
     * ArticleViewHeader hook.  For a current revision of an existing brew page,
     * emit the raw brew source into a hidden placeholder and suppress the stock
     * wikitext parse (E1S2, "no raw-markdown flash" - D9).  The render module
     * then replaces the placeholder with sanitized rendered HTML (E1S3).
     *
     * MediaWiki 1.14 signature: ( &$article, &$outputDone, &$pcache ).  This
     * hook fires from Article::view() only, so diffs (and action=raw) never
     * reach it.
     *
     * @param Article &$article    Article being viewed.
     * @param bool    &$outputDone Set true to skip the stock content output.
     * @param bool    &$pcache     Cleared so no parser-cache entry is written.
     * @return bool Always true.
     */
    public static function onArticleViewHeader( &$article, &$outputDone, &$pcache ) {
        if ( !( $article instanceof HomebreweryWiki_Article ) ) {
            return true;
        }

        $title = $article->getTitle();
        // Non-existent pages keep the stock "no article" screen; read-access
        // checks stay with core (never bypass userCanRead()).
        if ( ! $title->exists() || ! $title->userCanRead() ) {
            return true;
        }
        // Old revisions keep the stock path for this slice.
        if ( $article->getOldID() !== 0 ) {
            return true;
        }

        $outputDone = true;
        $pcache     = false;

        global $wgOut, $wgRequest;
        $text = $article->getBrewText();
        $wgOut->addHTML( self::brewPlaceholder( $text, self::isPrintRequest( $wgRequest ) ) );

        // E3.5S3T4: categories come from source tokens, not the wikitext
        // parser (brew views skip it). Register them for the skin footer.
        $categories = self::brewCategoryNames( $text );
        $categoryLinks = array();
        foreach ( $categories as $category ) {
            $key = self::categoryDbKey( $category );
            if ( $key !== null && $key !== '' ) {
                $categoryLinks[$key] = 'normal';
            }
        }
        if ( count( $categoryLinks ) ) {
            $wgOut->addCategoryLinks( $categoryLinks );
        }
        return true;
    }

    /**
     * Base URL for wiki links inside a brew (E3.5S3T2).
     *
     * Uses index.php?title= because it works for both pretty and ugly URLs on
     * MediaWiki 1.14. The render module appends an encoded title and marks
     * the anchor `target="_top"` so a click navigates the parent page.
     *
     * @return string
     */
    public static function wikiBaseUrl() {
        global $wgScriptPath;
        return $wgScriptPath . '/index.php?title=';
    }

    /**
     * JSON file map for the render module (E3.5S3T3).
     *
     * @param mixed $text Raw brew markdown.
     * @return string JSON object, safe to place in an HTML attribute.
     */
    public static function brewFileMapJson( $text ) {
        $map = self::brewFileMap( $text );
        if ( !function_exists( 'json_encode' ) ) {
            return '{}';
        }
        $json = json_encode( $map );
        return ( $json === false ) ? '{}' : $json;
    }

    /**
     * Build the hidden source placeholder the view module consumes (E1S2T2).
     *
     * The wrapper carries the single scoping class `.hbw-brew` (Q25).  The raw
     * brew source is HTML-escaped and hidden, so it is available to the module
     * (and to no-JS crawlers) but never flashed to the reader; the module builds
     * the visible <pre> from it and drops the placeholder.
     *
     * The hidden container is a <div>, not a <pre>: the HTML parser strips one
     * newline immediately after a <pre> start tag, which would eat a leading
     * newline in the saved source.  A <div> text node round-trips exactly.
     * The <noscript> block renders the escaped source for readers with JS off;
     * its <pre> deliberately starts with a sacrificial newline so the parser
     * strips that one instead of a real leading newline.  With JS on, the
     * render module also uses this exact source as its render input.
     *
     * @param mixed $text  Raw brew markdown.
     * @param bool  $print Whether this is the print route (E3.5S4).
     * @return string HTML fragment.
     */
    public static function brewPlaceholder( $text, $print = false ) {
        if ( !is_string( $text ) ) {
            $text = '';
        }
        $escaped = htmlspecialchars( $text, ENT_QUOTES, 'UTF-8' );
        $attrs = ' data-hbw-shell="' . htmlspecialchars( self::shellUrl(), ENT_QUOTES, 'UTF-8' ) . '"'
               . ' data-hbw-theme="' . htmlspecialchars( self::themeCssUrl(), ENT_QUOTES, 'UTF-8' ) . '"'
               . ' data-hbw-page-width="215.9"'
               . ' data-hbw-page-height="279.4"'
               . ' data-hbw-wiki-base="' . htmlspecialchars( self::wikiBaseUrl(), ENT_QUOTES, 'UTF-8' ) . '"'
               . ' data-hbw-files="' . htmlspecialchars( self::brewFileMapJson( $text ), ENT_QUOTES, 'UTF-8' ) . '"';
        if ( $print ) {
            $attrs .= ' data-hbw-print="1"';
        }
        return "<div class=\"hbw-brew\" id=\"hbw-brew\"" . $attrs . ">"
             . "<div class=\"hbw-source\" id=\"hbw-source\" style=\"display:none\">"
             . $escaped
             . "</div>"
             . "<noscript><pre class=\"hbw-brew-text\">\n"
             . $escaped
             . "</pre></noscript></div>\n";
    }
}
