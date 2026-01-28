#!/usr/bin/env python3
"""
EPT Hierarchy Quality Evaluator

Analyzes the quality of an Entwine Point Tile (EPT) dataset's octree hierarchy.
Evaluates structure, balance, density, and completeness metrics.

Usage:
    python ept_hierarchy_quality.py <ept_url>
    
Example:
    python ept_hierarchy_quality.py https://example.com/ept/
"""

import argparse
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass, field
from threading import Lock
from typing import Dict, List, Optional, Set, Tuple
from urllib.parse import urljoin

try:
    import requests
    from requests.adapters import HTTPAdapter
    from urllib3.util.retry import Retry
except ImportError:
    print("Error: 'requests' library is required. Install with: pip install requests")
    sys.exit(1)

try:
    import numpy as np
except ImportError:
    print("Error: 'numpy' library is required. Install with: pip install numpy")
    sys.exit(1)


@dataclass
class StructureMetrics:
    """Metrics about the tree structure."""
    total_nodes: int = 0
    max_depth: int = 0
    expected_depth: int = 0
    nodes_per_level: Dict[int, int] = field(default_factory=dict)
    avg_branching_factor: float = 0.0
    total_points: int = 0


@dataclass
class BalanceMetrics:
    """Metrics about tree balance."""
    balance_score: float = 0.0  # 0-100%
    cv_per_level: Dict[int, float] = field(default_factory=dict)  # Coefficient of variation
    points_per_level: Dict[int, int] = field(default_factory=dict)
    skewness_indicator: str = "balanced"


@dataclass
class DensityMetrics:
    """Metrics about point density per node."""
    min_points: int = 0
    max_points: int = 0
    mean_points: float = 0.0
    median_points: float = 0.0
    std_points: float = 0.0
    sparse_node_ratio: float = 0.0  # Nodes with < 100 points
    dense_node_ratio: float = 0.0   # Nodes near capacity


@dataclass
class CompletenessMetrics:
    """Metrics about hierarchy completeness."""
    coverage_ratio: float = 0.0  # Actual vs theoretical max nodes
    missing_nodes_estimate: int = 0
    empty_nodes: int = 0
    hierarchy_files_count: int = 0


@dataclass
class QualityReport:
    """Complete quality report for an EPT dataset."""
    url: str
    structure: StructureMetrics
    balance: BalanceMetrics
    density: DensityMetrics
    completeness: CompletenessMetrics
    errors: List[str] = field(default_factory=list)
    
    def print_report(self):
        """Print formatted console report."""
        print("\n" + "=" * 50)
        print("       EPT Hierarchy Quality Report")
        print("=" * 50)
        print(f"URL: {self.url}")
        
        if self.errors:
            print("\n--- Errors ---")
            for error in self.errors:
                print(f"  ! {error}")
        
        # Structure section
        print("\n--- Structure ---")
        print(f"Total Nodes: {self.structure.total_nodes:,}")
        print(f"Total Points: {self.structure.total_points:,}")
        print(f"Max Depth: {self.structure.max_depth} (expected: {self.structure.expected_depth})")
        print(f"Avg Branching Factor: {self.structure.avg_branching_factor:.2f}")
        print("Nodes by Level:")
        for level in sorted(self.structure.nodes_per_level.keys()):
            count = self.structure.nodes_per_level[level]
            print(f"  Level {level}: {count:,} nodes")
        
        # Balance section
        print("\n--- Balance ---")
        print(f"Balance Score: {self.balance.balance_score:.1f}%")
        print(f"Skewness: {self.balance.skewness_indicator}")
        print("Coefficient of Variation by Level:")
        for level in sorted(self.balance.cv_per_level.keys()):
            cv = self.balance.cv_per_level[level]
            quality = "good" if cv < 0.5 else "moderate" if cv < 1.0 else "high variance"
            print(f"  Level {level}: CV={cv:.3f} ({quality})")
        print("Points by Level:")
        for level in sorted(self.balance.points_per_level.keys()):
            points = self.balance.points_per_level[level]
            print(f"  Level {level}: {points:,} points")
        
        # Density section
        print("\n--- Density ---")
        print(f"Points/Node: min={self.density.min_points:,}, max={self.density.max_points:,}")
        print(f"             mean={self.density.mean_points:,.1f}, median={self.density.median_points:,.1f}")
        if self.density.std_points > 0:
            print(f"             std={self.density.std_points:,.1f}")
        print(f"Sparse Nodes (<10k pts): {self.density.sparse_node_ratio:.1f}%")
        print(f"Dense Nodes (>100k pts): {self.density.dense_node_ratio:.1f}%")
        
        # Completeness section
        print("\n--- Completeness ---")
        print(f"Hierarchy Files: {self.completeness.hierarchy_files_count}")
        print(f"Empty Nodes (0 points): {self.completeness.empty_nodes:,}")
        print(f"Coverage Ratio: {self.completeness.coverage_ratio:.1f}%")
        
        # Overall assessment
        print("\n--- Overall Assessment ---")
        score = self._calculate_overall_score()
        if score >= 80:
            assessment = "Excellent - Well-structured hierarchy"
        elif score >= 60:
            assessment = "Good - Minor issues detected"
        elif score >= 40:
            assessment = "Fair - Some structural concerns"
        else:
            assessment = "Poor - Significant hierarchy issues"
        print(f"Quality Score: {score:.1f}/100")
        print(f"Assessment: {assessment}")
        print("=" * 50 + "\n")
    
    def _calculate_overall_score(self) -> float:
        """Calculate an overall quality score from 0-100."""
        scores = []
        
        # Structure score: depth reached vs expected
        if self.structure.expected_depth > 0:
            depth_ratio = self.structure.max_depth / self.structure.expected_depth
            scores.append(min(100, depth_ratio * 100))
        
        # Balance score
        scores.append(self.balance.balance_score)
        
        # Density score: penalize too many sparse or overly dense nodes
        density_score = 100 - (self.density.sparse_node_ratio + self.density.dense_node_ratio) / 2
        scores.append(max(0, density_score))
        
        # Completeness score
        scores.append(self.completeness.coverage_ratio)
        
        return float(np.mean(scores)) if scores else 0.0


class EPTHierarchyAnalyzer:
    """Analyzer for EPT dataset hierarchy quality."""
    
    SPARSE_THRESHOLD = 10000  # Points below this = sparse node
    DENSE_THRESHOLD = 100000  # Points above this = dense node
    
    def __init__(self, ept_url: str, timeout: int = 30, max_workers: int = 32):
        """
        Initialize analyzer with EPT dataset URL.
        
        Args:
            ept_url: Base URL of the EPT dataset (should contain ept.json)
            timeout: HTTP request timeout in seconds
            max_workers: Maximum number of parallel HTTP requests
        """
        # Ensure URL ends with /
        self.base_url = ept_url.rstrip('/') + '/'
        self.timeout = timeout
        self.max_workers = max_workers
        
        # Create session with connection pooling and retries
        self.session = requests.Session()
        
        # Configure retry strategy
        retry_strategy = Retry(
            total=3,
            backoff_factor=0.5,
            status_forcelist=[429, 500, 502, 503, 504],
        )
        adapter = HTTPAdapter(
            max_retries=retry_strategy,
            pool_connections=max_workers,
            pool_maxsize=max_workers * 2
        )
        self.session.mount("http://", adapter)
        self.session.mount("https://", adapter)
        self.session.headers.update({
            'User-Agent': 'EPT-Hierarchy-Analyzer/1.0',
            'Accept-Encoding': 'gzip, deflate',
        })
        
        self.metadata: Optional[dict] = None
        self.hierarchy: Dict[str, int] = {}  # node_key -> point_count
        self.hierarchy_files_fetched = 0
        self.errors: List[str] = []
        
        # Thread-safe structures for parallel fetching
        self._hierarchy_lock = Lock()
        self._errors_lock = Lock()
        self._counter_lock = Lock()
    
    def fetch_metadata(self) -> Optional[dict]:
        """Fetch and parse ept.json metadata."""
        url = urljoin(self.base_url, 'ept.json')
        try:
            response = self.session.get(url, timeout=self.timeout)
            response.raise_for_status()
            self.metadata = response.json()
            return self.metadata
        except requests.RequestException as e:
            self.errors.append(f"Failed to fetch ept.json: {e}")
            return None
        except ValueError as e:
            self.errors.append(f"Invalid JSON in ept.json: {e}")
            return None
    
    def fetch_hierarchy(self) -> Dict[str, int]:
        """
        Fetch all hierarchy files using parallel requests.
        
        EPT hierarchy files are stored in ept-hierarchy/ directory.
        The root file is 0-0-0-0.json. Each file contains point counts
        for nodes and may reference additional hierarchy files for deeper nodes.
        
        Uses breadth-first parallel fetching for optimal performance.
        """
        self.hierarchy = {}
        self.hierarchy_files_fetched = 0
        
        # Track which files need to be fetched and which have been fetched
        pending_files: Set[str] = {"0-0-0-0"}
        fetched_files: Set[str] = set()
        
        start_time = time.time()
        
        while pending_files:
            # Get batch of files to fetch
            batch = list(pending_files)
            pending_files.clear()
            
            # Fetch batch in parallel
            new_references = self._fetch_hierarchy_batch(batch)
            fetched_files.update(batch)
            
            # Add new references that haven't been fetched yet
            for ref in new_references:
                if ref not in fetched_files:
                    pending_files.add(ref)
            
            # Progress report
            elapsed = time.time() - start_time
            rate = self.hierarchy_files_fetched / elapsed if elapsed > 0 else 0
            print(f"\r  Fetched {self.hierarchy_files_fetched:,} files, "
                  f"{len(self.hierarchy):,} nodes "
                  f"({rate:.1f} files/sec)...", end="", flush=True)
        
        print()  # New line after progress
        return self.hierarchy
    
    def _fetch_hierarchy_batch(self, node_keys: List[str]) -> Set[str]:
        """
        Fetch a batch of hierarchy files in parallel.
        
        Returns:
            Set of node keys that reference additional hierarchy files
        """
        new_references: Set[str] = set()
        refs_lock = Lock()
        
        def fetch_single(node_key: str) -> None:
            """Fetch a single hierarchy file."""
            url = urljoin(self.base_url, f'ept-hierarchy/{node_key}.json')
            
            try:
                response = self.session.get(url, timeout=self.timeout)
                response.raise_for_status()
                data = response.json()
                
                with self._counter_lock:
                    self.hierarchy_files_fetched += 1
                
                # Process hierarchy data
                local_hierarchy = {}
                local_refs = []
                
                for key, value in data.items():
                    if value >= 0:
                        local_hierarchy[key] = value
                    else:
                        # Negative value = reference to another hierarchy file
                        local_hierarchy[key] = abs(value)
                        local_refs.append(key)
                
                # Update shared state
                with self._hierarchy_lock:
                    self.hierarchy.update(local_hierarchy)
                
                if local_refs:
                    with refs_lock:
                        new_references.update(local_refs)
                        
            except requests.RequestException as e:
                with self._errors_lock:
                    self.errors.append(f"Failed to fetch hierarchy {node_key}.json: {e}")
            except ValueError as e:
                with self._errors_lock:
                    self.errors.append(f"Invalid JSON in {node_key}.json: {e}")
        
        # Execute batch in parallel
        with ThreadPoolExecutor(max_workers=self.max_workers) as executor:
            futures = [executor.submit(fetch_single, key) for key in node_keys]
            # Wait for all to complete
            for future in as_completed(futures):
                # This will raise any exceptions from the threads
                try:
                    future.result()
                except Exception:
                    pass  # Errors already captured in fetch_single
        
        return new_references
    
    def _parse_node_keys_batch(self, keys: List[str]) -> np.ndarray:
        """
        Parse multiple node keys into numpy array of (depth, x, y, z).
        
        Returns:
            numpy array of shape (n, 4) with columns [depth, x, y, z]
        """
        result = np.zeros((len(keys), 4), dtype=np.int32)
        for i, key in enumerate(keys):
            parts = key.split('-')
            result[i] = [int(parts[0]), int(parts[1]), int(parts[2]), int(parts[3])]
        return result
    
    def _parse_node_key(self, key: str) -> Tuple[int, int, int, int]:
        """Parse node key 'D-X-Y-Z' into (depth, x, y, z) tuple."""
        parts = key.split('-')
        return int(parts[0]), int(parts[1]), int(parts[2]), int(parts[3])
    
    def _calculate_structure_metrics(self) -> StructureMetrics:
        """Calculate tree structure metrics using numpy for performance."""
        metrics = StructureMetrics()
        
        if not self.hierarchy:
            return metrics
        
        keys = list(self.hierarchy.keys())
        values = list(self.hierarchy.values())
        
        point_counts = np.array(values, dtype=np.int64)
        node_data = self._parse_node_keys_batch(keys)
        depths = node_data[:, 0]
        
        metrics.total_nodes = len(keys)
        metrics.total_points = int(point_counts.sum())
        metrics.max_depth = int(depths.max())
        
        # Count nodes per level using numpy bincount
        nodes_per_level = np.bincount(depths)
        metrics.nodes_per_level = {i: int(count) for i, count in enumerate(nodes_per_level) if count > 0}
        
        # Get expected depth from metadata
        if self.metadata and 'span' in self.metadata:
            import math
            span = self.metadata['span']
            metrics.expected_depth = int(math.log2(span)) if span > 0 else 0
        
        # Calculate average branching factor
        total_children = 0
        non_leaf_nodes = 0
        for level in range(metrics.max_depth):
            if level in metrics.nodes_per_level and (level + 1) in metrics.nodes_per_level:
                non_leaf_nodes += metrics.nodes_per_level[level]
                total_children += metrics.nodes_per_level[level + 1]
        
        if non_leaf_nodes > 0:
            metrics.avg_branching_factor = total_children / non_leaf_nodes
        
        return metrics
    
    def _calculate_balance_metrics(self) -> BalanceMetrics:
        """Calculate tree balance metrics using numpy for performance."""
        metrics = BalanceMetrics()
        
        if not self.hierarchy:
            return metrics
        
        keys = list(self.hierarchy.keys())
        values = list(self.hierarchy.values())
        
        point_counts = np.array(values, dtype=np.int64)
        node_data = self._parse_node_keys_batch(keys)
        depths = node_data[:, 0]
        
        max_depth = int(depths.max())
        cv_values = []
        
        for level in range(max_depth + 1):
            mask = depths == level
            level_points = point_counts[mask]
            
            if len(level_points) > 0:
                metrics.points_per_level[level] = int(level_points.sum())
                
                if len(level_points) > 1:
                    m = level_points.mean()
                    if m > 0:
                        s = level_points.std()
                        cv = float(s / m)
                        metrics.cv_per_level[level] = cv
                        cv_values.append(cv)
        
        # Calculate overall balance score
        if cv_values:
            avg_cv = np.mean(cv_values)
            metrics.balance_score = max(0, min(100, (1 - avg_cv / 2) * 100))
        else:
            metrics.balance_score = 100.0
        
        # Determine skewness
        if metrics.balance_score >= 80:
            metrics.skewness_indicator = "well-balanced"
        elif metrics.balance_score >= 60:
            metrics.skewness_indicator = "slightly unbalanced"
        elif metrics.balance_score >= 40:
            metrics.skewness_indicator = "moderately unbalanced"
        else:
            metrics.skewness_indicator = "highly unbalanced"
        
        return metrics
    
    def _calculate_density_metrics(self) -> DensityMetrics:
        """Calculate point density metrics using numpy for performance."""
        metrics = DensityMetrics()
        
        if not self.hierarchy:
            return metrics
        
        point_counts = np.array(list(self.hierarchy.values()), dtype=np.int64)
        non_zero_mask = point_counts > 0
        non_zero_counts = point_counts[non_zero_mask]
        
        if len(non_zero_counts) == 0:
            return metrics
        
        metrics.min_points = int(non_zero_counts.min())
        metrics.max_points = int(non_zero_counts.max())
        metrics.mean_points = float(non_zero_counts.mean())
        metrics.median_points = float(np.median(non_zero_counts))
        
        if len(non_zero_counts) > 1:
            metrics.std_points = float(non_zero_counts.std())
        
        # Calculate sparse and dense ratios using vectorized operations
        total_nodes = len(point_counts)
        sparse_count = int(np.sum((point_counts > 0) & (point_counts < self.SPARSE_THRESHOLD)))
        dense_count = int(np.sum(point_counts > self.DENSE_THRESHOLD))
        
        metrics.sparse_node_ratio = (sparse_count / total_nodes) * 100 if total_nodes > 0 else 0
        metrics.dense_node_ratio = (dense_count / total_nodes) * 100 if total_nodes > 0 else 0
        
        return metrics
    
    def _calculate_completeness_metrics(self, structure: StructureMetrics) -> CompletenessMetrics:
        """Calculate hierarchy completeness metrics."""
        metrics = CompletenessMetrics()
        
        if not self.hierarchy:
            return metrics
        
        metrics.hierarchy_files_count = self.hierarchy_files_fetched
        
        point_counts = np.array(list(self.hierarchy.values()), dtype=np.int64)
        metrics.empty_nodes = int(np.sum(point_counts == 0))
        
        # Calculate theoretical maximum nodes for a perfect octree
        # Sum of 8^d for d from 0 to max_depth
        max_depth = structure.max_depth
        theoretical_max = sum(8 ** d for d in range(max_depth + 1))
        
        # Coverage ratio: actual nodes vs theoretical max
        if theoretical_max > 0:
            metrics.coverage_ratio = (structure.total_nodes / theoretical_max) * 100
        
        # Estimate missing nodes - check for gaps where children exist without parents
        # Use set for O(1) lookups
        existing_keys = set(self.hierarchy.keys())
        missing = 0
        
        # Batch process for better performance
        for key in existing_keys:
            parts = key.split('-')
            depth = int(parts[0])
            if depth > 0:
                x, y, z = int(parts[1]), int(parts[2]), int(parts[3])
                parent_key = f"{depth - 1}-{x // 2}-{y // 2}-{z // 2}"
                if parent_key not in existing_keys:
                    missing += 1
        
        metrics.missing_nodes_estimate = missing
        
        return metrics
    
    def analyze(self) -> QualityReport:
        """
        Perform complete analysis of the EPT hierarchy.
        
        Returns:
            QualityReport with all metrics
        """
        total_start = time.time()
        
        print(f"Analyzing EPT dataset: {self.base_url}")
        print(f"  Using {self.max_workers} parallel workers")
        
        # Fetch metadata
        print("  Fetching metadata...")
        self.fetch_metadata()
        
        if self.metadata:
            name = self.metadata.get('name', 'Unknown')
            points = self.metadata.get('points', 0)
            print(f"  Dataset: {name}")
            print(f"  Points: {points:,}")
        
        # Fetch hierarchy with timing
        print("  Fetching hierarchy...")
        fetch_start = time.time()
        self.fetch_hierarchy()
        fetch_time = time.time() - fetch_start
        
        print(f"  Fetched {self.hierarchy_files_fetched:,} hierarchy file(s) in {fetch_time:.1f}s")
        print(f"  Found {len(self.hierarchy):,} nodes")
        
        # Calculate metrics with timing
        print("  Calculating metrics...")
        calc_start = time.time()
        structure = self._calculate_structure_metrics()
        balance = self._calculate_balance_metrics()
        density = self._calculate_density_metrics()
        completeness = self._calculate_completeness_metrics(structure)
        calc_time = time.time() - calc_start
        
        total_time = time.time() - total_start
        print(f"  Metrics calculated in {calc_time:.2f}s")
        print(f"  Total analysis time: {total_time:.1f}s")
        
        return QualityReport(
            url=self.base_url,
            structure=structure,
            balance=balance,
            density=density,
            completeness=completeness,
            errors=self.errors
        )


def main():
    """Main entry point for CLI."""
    parser = argparse.ArgumentParser(
        description='Evaluate the quality of an EPT dataset hierarchy.',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python ept_hierarchy_quality.py https://example.com/ept/
  python ept_hierarchy_quality.py https://s3.amazonaws.com/bucket/pointcloud/ept/ --workers 64
        """
    )
    parser.add_argument(
        'url',
        help='Base URL of the EPT dataset (should contain ept.json)'
    )
    parser.add_argument(
        '--timeout',
        type=int,
        default=30,
        help='HTTP request timeout in seconds (default: 30)'
    )
    parser.add_argument(
        '--workers', '-w',
        type=int,
        default=32,
        help='Number of parallel HTTP workers (default: 32, increase for faster fetching)'
    )
    
    args = parser.parse_args()
    
    # Run analysis
    analyzer = EPTHierarchyAnalyzer(
        args.url, 
        timeout=args.timeout,
        max_workers=args.workers
    )
    report = analyzer.analyze()
    report.print_report()
    
    # Exit with error code if there were issues
    if report.errors:
        sys.exit(1)


if __name__ == '__main__':
    main()
